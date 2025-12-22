import { EventEmitter } from 'events';

interface RetryConfig {
  maxAttempts: number;
  baseDelay: number; // Base delay in ms
  maxDelay: number; // Maximum delay in ms
  backoffStrategy: 'exponential' | 'linear' | 'fixed';
  jitter: boolean; // Add randomness to prevent thundering herd
  retryableErrors: string[]; // Error messages/types that should trigger retry
  circuitBreaker?: CircuitBreakerConfig;
}

interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number; // Number of failures to trip circuit
  recoveryTimeout: number; // Time to wait before trying again (ms)
  monitoringWindow: number; // Time window to track failures (ms)
}

interface RetryAttempt {
  attempt: number;
  delay: number;
  error: Error;
  timestamp: number;
}

interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: RetryAttempt[];
  totalTime: number;
  circuitBreakerTripped?: boolean;
}

enum CircuitState {
  CLOSED = 'closed', // Normal operation
  OPEN = 'open', // Circuit tripped, failing fast
  HALF_OPEN = 'half-open', // Testing if service recovered
}

class CircuitBreaker extends EventEmitter {
  private state = CircuitState.CLOSED;
  private failures = 0;
  private lastFailureTime = 0;
  private nextAttemptTime = 0;
  private recentFailures: number[] = [];

  constructor(private config: CircuitBreakerConfig) {
    super();
  }

  canExecute(): boolean {
    this.cleanOldFailures();

    switch (this.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        if (Date.now() >= this.nextAttemptTime) {
          this.state = CircuitState.HALF_OPEN;
          this.emit('state-change', { from: 'open', to: 'half-open' });
          return true;
        }
        return false;

      case CircuitState.HALF_OPEN:
        return true;

      default:
        return false;
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.recentFailures = [];

    if (this.state !== CircuitState.CLOSED) {
      this.state = CircuitState.CLOSED;
      this.emit('state-change', { to: 'closed' });
      this.emit('circuit-closed');
    }
  }

  recordFailure(): void {
    const now = Date.now();
    this.failures++;
    this.lastFailureTime = now;
    this.recentFailures.push(now);

    this.cleanOldFailures();

    if (this.state === CircuitState.HALF_OPEN) {
      this.tripCircuit();
    } else if (this.recentFailures.length >= this.config.failureThreshold) {
      this.tripCircuit();
    }
  }

  private tripCircuit(): void {
    this.state = CircuitState.OPEN;
    this.nextAttemptTime = Date.now() + this.config.recoveryTimeout;
    this.emit('state-change', { to: 'open' });
    this.emit('circuit-opened', {
      failures: this.failures,
      recentFailures: this.recentFailures.length,
    });
  }

  private cleanOldFailures(): void {
    const cutoff = Date.now() - this.config.monitoringWindow;
    this.recentFailures = this.recentFailures.filter((time) => time > cutoff);
  }

  getState(): {
    state: CircuitState;
    failures: number;
    recentFailures: number;
  } {
    this.cleanOldFailures();
    return {
      state: this.state,
      failures: this.failures,
      recentFailures: this.recentFailures.length,
    };
  }
}

class RetryManager extends EventEmitter {
  private circuitBreakers = new Map<string, CircuitBreaker>();
  private defaultConfig: RetryConfig = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffStrategy: 'exponential',
    jitter: true,
    retryableErrors: [
      'ECONNRESET',
      'ENOTFOUND',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'Model loading failed',
      'Worker error',
      'Processing timeout',
      'Memory allocation failed',
    ],
    circuitBreaker: {
      enabled: true,
      failureThreshold: 5,
      recoveryTimeout: 30000,
      monitoringWindow: 60000,
    },
  };

  constructor(private config: Partial<RetryConfig> = {}) {
    super();
    this.config = { ...this.defaultConfig, ...config };
  }

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string,
    customConfig?: Partial<RetryConfig>,
  ): Promise<RetryResult<T>> {
    const finalConfig: RetryConfig = {
      ...this.defaultConfig,
      ...this.config,
      ...customConfig,
    };
    const circuitBreaker = this.getCircuitBreaker(
      context,
      finalConfig.circuitBreaker!,
    );
    const attempts: RetryAttempt[] = [];
    const startTime = Date.now();

    // Check circuit breaker
    if (finalConfig.circuitBreaker?.enabled && !circuitBreaker.canExecute()) {
      return {
        success: false,
        error: new Error(`Circuit breaker is OPEN for context: ${context}`),
        attempts: [],
        totalTime: 0,
        circuitBreakerTripped: true,
      };
    }

    for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
      try {
        this.emit('attempt-start', {
          context,
          attempt,
          maxAttempts: finalConfig.maxAttempts,
        });

        const result = await operation();

        // Success - record in circuit breaker
        if (finalConfig.circuitBreaker?.enabled) {
          circuitBreaker.recordSuccess();
        }

        this.emit('attempt-success', { context, attempt, result });

        return {
          success: true,
          result,
          attempts,
          totalTime: Date.now() - startTime,
        };
      } catch (error: Error | any) {
        const retryAttempt: RetryAttempt = {
          attempt,
          delay: 0,
          error: error,
          timestamp: Date.now(),
        };

        attempts.push(retryAttempt);

        this.emit('attempt-failed', {
          context,
          attempt,
          error,
          willRetry: attempt < finalConfig.maxAttempts,
        });

        // Check if error is retryable
        if (!this.isRetryableError(error, finalConfig)) {
          this.emit('non-retryable-error', { context, error });

          if (finalConfig.circuitBreaker?.enabled) {
            circuitBreaker.recordFailure();
          }

          return {
            success: false,
            error,
            attempts,
            totalTime: Date.now() - startTime,
          };
        }

        // Record failure in circuit breaker
        if (finalConfig.circuitBreaker?.enabled) {
          circuitBreaker.recordFailure();
        }

        // If this was the last attempt, don't delay
        if (attempt >= finalConfig.maxAttempts) {
          break;
        }

        // Calculate delay for next attempt
        const delay = this.calculateDelay(attempt, finalConfig);
        retryAttempt.delay = delay;

        this.emit('retry-delay', { context, attempt, delay });

        await this.sleep(delay);
      }
    }

    // All attempts failed
    const lastError =
      attempts[attempts.length - 1]?.error || new Error('Unknown error');

    this.emit('all-attempts-failed', {
      context,
      attempts: attempts.length,
      totalTime: Date.now() - startTime,
      error: lastError,
    });

    return {
      success: false,
      error: lastError,
      attempts,
      totalTime: Date.now() - startTime,
    };
  }

  private getCircuitBreaker(
    context: string,
    config: CircuitBreakerConfig,
  ): CircuitBreaker {
    if (!this.circuitBreakers.has(context)) {
      const breaker = new CircuitBreaker(config);

      breaker.on('circuit-opened', (data) => {
        this.emit('circuit-breaker-opened', { context, ...data });
      });

      breaker.on('circuit-closed', () => {
        this.emit('circuit-breaker-closed', { context });
      });

      this.circuitBreakers.set(context, breaker);
    }

    return this.circuitBreakers.get(context)!;
  }

  private isRetryableError(error: Error | any, config: RetryConfig): boolean {
    const errorMessage = error.message.toLowerCase();
    const errorCode = error.code;

    return config.retryableErrors.some((retryableError) => {
      const retryable = retryableError.toLowerCase();
      return errorMessage.includes(retryable) || errorCode === retryableError;
    });
  }

  private calculateDelay(attempt: number, config: RetryConfig): number {
    let delay: number;

    switch (config.backoffStrategy) {
      case 'exponential':
        delay = config.baseDelay * Math.pow(2, attempt - 1);
        break;

      case 'linear':
        delay = config.baseDelay * attempt;
        break;

      case 'fixed':
      default:
        delay = config.baseDelay;
        break;
    }

    // Apply maximum delay limit
    delay = Math.min(delay, config.maxDelay);

    // Add jitter to prevent thundering herd
    if (config.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }

    return Math.floor(delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Utility methods for getting retry statistics
  getCircuitBreakerStats(): Record<string, any> {
    const stats: Record<string, any> = {};

    this.circuitBreakers.forEach((breaker, context) => {
      stats[context] = breaker.getState();
    });

    return stats;
  }

  resetCircuitBreaker(context: string): void {
    const breaker = this.circuitBreakers.get(context);
    if (breaker) {
      breaker.recordSuccess(); // This will close the circuit
      this.emit('circuit-breaker-reset', { context });
    }
  }

  resetAllCircuitBreakers(): void {
    this.circuitBreakers.forEach((breaker, context) => {
      breaker.recordSuccess();
    });
    this.emit('all-circuit-breakers-reset');
  }

  dispose(): void {
    this.circuitBreakers.clear();
    this.removeAllListeners();
  }
}

export { RetryManager };
export type { CircuitBreakerConfig, RetryAttempt, RetryConfig, RetryResult };
