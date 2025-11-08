enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: string;
  data?: any;
}

class Logger {
  constructor(
    private context: string,
    private minLevel: LogLevel = LogLevel.INFO,
  ) {}

  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, error?: Error | any): void {
    this.log(LogLevel.ERROR, message, error);
  }

  private log(level: LogLevel, message: string, data?: any): void {
    if (level < this.minLevel) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      context: this.context,
      data,
    };

    this.output(entry);
  }

  private output(entry: LogEntry): void {
    const levelName = LogLevel[entry.level];
    const timestamp = entry.timestamp.toISOString();
    const prefix = `[${timestamp}] ${levelName} [${entry.context}]`;

    switch (entry.level) {
      case LogLevel.ERROR:
        console.error(`${prefix} ${entry.message}`, entry.data || '');
        break;
      case LogLevel.WARN:
        console.warn(`${prefix} ${entry.message}`, entry.data || '');
        break;
      case LogLevel.DEBUG:
        if (process.env.DEBUG) {
          console.debug(`${prefix} ${entry.message}`, entry.data || '');
        }
        break;
      default:
        console.log(`${prefix} ${entry.message}`, entry.data || '');
    }
  }
}

// Factory function for creating loggers
function createLogger(context: string): Logger {
  const level = process.env.LOG_LEVEL
    ? LogLevel[process.env.LOG_LEVEL as keyof typeof LogLevel]
    : LogLevel.INFO;

  return new Logger(context, level);
}

export { createLogger, Logger, LogLevel };

export type { LogEntry };
