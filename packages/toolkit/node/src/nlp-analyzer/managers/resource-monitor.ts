import { EventEmitter } from 'events';
import * as os from 'os';
import { performance } from 'perf_hooks';

interface ResourceMetrics {
  timestamp: number;
  cpu: {
    usage: number; // CPU usage percentage
    loadAverage: number[]; // 1, 5, 15 minute load averages
  };
  memory: {
    used: number; // Used memory in MB
    free: number; // Free memory in MB
    total: number; // Total memory in MB
    usage: number; // Memory usage percentage
    heapUsed: number; // Node.js heap used in MB
    heapTotal: number; // Node.js heap total in MB
  };
  process: {
    pid: number;
    uptime: number; // Process uptime in seconds
    cpuUsage: NodeJS.CpuUsage;
  };
  nlp: {
    documentsProcessed: number;
    totalProcessingTime: number; // Total time spent processing in ms
    averageProcessingTime: number; // Average processing time per document in ms
    activeWorkers: number;
    queuedTasks: number;
    modelsLoaded: number;
    cacheHitRate: number;
  };
}

interface ResourceAlert {
  type: 'cpu' | 'memory' | 'processing' | 'queue';
  level: 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  timestamp: number;
}

interface MonitoringConfig {
  enabled: boolean;
  interval: number; // Monitoring interval in ms
  retentionPeriod: number; // How long to keep metrics in ms
  alerts: {
    cpuThreshold: number; // CPU usage threshold (%)
    memoryThreshold: number; // Memory usage threshold (%)
    queueThreshold: number; // Queue size threshold
    processingTimeThreshold: number; // Processing time threshold (ms)
  };
}

class ResourceMonitor extends EventEmitter {
  private metrics: ResourceMetrics[] = [];
  private monitoringInterval?: NodeJS.Timeout;
  private startTime = Date.now();
  private lastCpuUsage = process.cpuUsage();

  // NLP-specific metrics
  private nlpMetrics = {
    documentsProcessed: 0,
    totalProcessingTime: 0,
    activeWorkers: 0,
    queuedTasks: 0,
    modelsLoaded: 0,
    cacheHitRate: 0,
  };

  private config: MonitoringConfig = {
    enabled: true,
    interval: 5000, // 5 seconds
    retentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
    alerts: {
      cpuThreshold: 80,
      memoryThreshold: 85,
      queueThreshold: 100,
      processingTimeThreshold: 30000, // 30 seconds
    },
  };

  constructor(config?: Partial<MonitoringConfig>) {
    super();

    if (config) {
      this.config = { ...this.config, ...config };
    }

    // ✅ Only start monitoring if explicitly enabled and not in fast mode
    if (this.config.enabled && process.env.NODE_ENV !== 'production') {
      this.start();
    }
  }

  start(): void {
    if (this.monitoringInterval) {
      return; // Already running
    }

    // ✅ Comment out monitoring start message
    if (process.env.DEBUG) {
      console.log('📊 Resource monitoring started');
    }

    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.interval);

    // Initial collection
    this.collectMetrics();
  }

  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      // ✅ Comment out monitoring stop message
      if (process.env.DEBUG) {
        console.log('📊 Resource monitoring stopped');
      }
    }
  }

  private async collectMetrics(): Promise<void> {
    const now = Date.now();
    const currentCpuUsage = process.cpuUsage(this.lastCpuUsage);

    // Calculate CPU usage percentage
    const cpuPercent =
      ((currentCpuUsage.user + currentCpuUsage.system) /
        1000000 /
        (this.config.interval / 1000)) *
      100;

    // Memory metrics
    const memoryUsage = process.memoryUsage();
    const systemMemory = {
      total: os.totalmem(),
      free: os.freemem(),
    };
    const memoryUsed = systemMemory.total - systemMemory.free;

    const metrics: ResourceMetrics = {
      timestamp: now,
      cpu: {
        usage: Math.min(100, cpuPercent),
        loadAverage: os.loadavg(),
      },
      memory: {
        used: Math.round(memoryUsed / 1024 / 1024),
        free: Math.round(systemMemory.free / 1024 / 1024),
        total: Math.round(systemMemory.total / 1024 / 1024),
        usage: Math.round((memoryUsed / systemMemory.total) * 100),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      },
      process: {
        pid: process.pid,
        uptime: Math.round((now - this.startTime) / 1000),
        cpuUsage: currentCpuUsage,
      },
      nlp: {
        documentsProcessed: this.nlpMetrics.documentsProcessed,
        totalProcessingTime: this.nlpMetrics.totalProcessingTime,
        averageProcessingTime:
          this.nlpMetrics.documentsProcessed > 0
            ? this.nlpMetrics.totalProcessingTime /
              this.nlpMetrics.documentsProcessed
            : 0,
        activeWorkers: this.nlpMetrics.activeWorkers,
        queuedTasks: this.nlpMetrics.queuedTasks,
        modelsLoaded: this.nlpMetrics.modelsLoaded,
        cacheHitRate: this.nlpMetrics.cacheHitRate,
      },
    };

    // Store metrics
    this.metrics.push(metrics);
    this.lastCpuUsage = process.cpuUsage();

    // Clean old metrics
    this.cleanOldMetrics();

    // Check for alerts
    this.checkAlerts(metrics);

    // Emit metrics
    this.emit('metrics', metrics);
  }

  private cleanOldMetrics(): void {
    const cutoffTime = Date.now() - this.config.retentionPeriod;
    this.metrics = this.metrics.filter((m) => m.timestamp > cutoffTime);
  }

  private checkAlerts(metrics: ResourceMetrics): void {
    const alerts: ResourceAlert[] = [];

    // CPU alert
    if (metrics.cpu.usage > this.config.alerts.cpuThreshold) {
      alerts.push({
        type: 'cpu',
        level: metrics.cpu.usage > 95 ? 'critical' : 'warning',
        message: `High CPU usage: ${metrics.cpu.usage.toFixed(1)}%`,
        value: metrics.cpu.usage,
        threshold: this.config.alerts.cpuThreshold,
        timestamp: metrics.timestamp,
      });
    }

    // Memory alert with suggestions
    if (metrics.memory.usage > this.config.alerts.memoryThreshold) {
      const level = metrics.memory.usage > 95 ? 'critical' : 'warning';
      const suggestion =
        metrics.memory.usage > 95
          ? ' (Consider reducing batch size or worker count)'
          : '';

      alerts.push({
        type: 'memory',
        level,
        message: `High memory usage: ${metrics.memory.usage}%${suggestion}`,
        value: metrics.memory.usage,
        threshold: this.config.alerts.memoryThreshold,
        timestamp: metrics.timestamp,
      });

      // ✅ Only show memory tips in debug mode
      if (metrics.memory.usage > 95 && process.env.DEBUG) {
        console.log('💡 Memory Management Tips:');
        console.log('   - Reduce batch size (e.g., batchSize: 5)');
        console.log('   - Reduce worker count (e.g., maxWorkers: 2)');
        console.log('   - Process documents sequentially (useWorkers: false)');
        console.log('   - Clear cache more frequently');
      }
    }

    // Queue alert
    if (metrics.nlp.queuedTasks > this.config.alerts.queueThreshold) {
      alerts.push({
        type: 'queue',
        level:
          metrics.nlp.queuedTasks > this.config.alerts.queueThreshold * 2
            ? 'critical'
            : 'warning',
        message: `High queue size: ${metrics.nlp.queuedTasks} tasks`,
        value: metrics.nlp.queuedTasks,
        threshold: this.config.alerts.queueThreshold,
        timestamp: metrics.timestamp,
      });
    }

    // Processing time alert
    if (
      metrics.nlp.averageProcessingTime >
      this.config.alerts.processingTimeThreshold
    ) {
      alerts.push({
        type: 'processing',
        level: 'warning',
        message: `Slow processing: ${metrics.nlp.averageProcessingTime.toFixed(0)}ms avg`,
        value: metrics.nlp.averageProcessingTime,
        threshold: this.config.alerts.processingTimeThreshold,
        timestamp: metrics.timestamp,
      });
    }

    // Emit alerts - but reduce console spam
    alerts.forEach((alert) => {
      this.emit('alert', alert);
      // ✅ Only log critical alerts to console
      if (alert.level === 'critical') {
        console.warn(`🚨 ${alert.level.toUpperCase()}: ${alert.message}`);
      } else if (process.env.DEBUG) {
        console.warn(`⚠️ ${alert.level.toUpperCase()}: ${alert.message}`);
      }
    });
  }

  // Methods for updating NLP metrics
  recordDocumentProcessed(processingTime: number): void {
    this.nlpMetrics.documentsProcessed++;
    this.nlpMetrics.totalProcessingTime += processingTime;
  }

  updateWorkerStats(activeWorkers: number, queuedTasks: number): void {
    this.nlpMetrics.activeWorkers = activeWorkers;
    this.nlpMetrics.queuedTasks = queuedTasks;
  }

  updateModelCount(count: number): void {
    this.nlpMetrics.modelsLoaded = count;
  }

  updateCacheHitRate(hitRate: number): void {
    this.nlpMetrics.cacheHitRate = hitRate;
  }

  // Query methods
  getCurrentMetrics(): ResourceMetrics | undefined {
    return this.metrics[this.metrics.length - 1];
  }

  getMetrics(startTime?: number, endTime?: number): ResourceMetrics[] {
    if (!startTime && !endTime) {
      return [...this.metrics];
    }

    return this.metrics.filter((m) => {
      if (startTime && m.timestamp < startTime) return false;
      if (endTime && m.timestamp > endTime) return false;
      return true;
    });
  }

  getAverageMetrics(minutes: number = 5): Partial<ResourceMetrics> {
    const cutoffTime = Date.now() - minutes * 60 * 1000;
    const recentMetrics = this.metrics.filter((m) => m.timestamp > cutoffTime);

    if (recentMetrics.length === 0) {
      return {};
    }

    const avg = recentMetrics.reduce(
      (acc, m) => {
        acc.cpu.usage += m.cpu.usage;
        acc.memory.usage += m.memory.usage;
        acc.nlp.averageProcessingTime += m.nlp.averageProcessingTime;
        return acc;
      },
      {
        cpu: { usage: 0 },
        memory: { usage: 0 },
        nlp: { averageProcessingTime: 0 },
      },
    );

    const count = recentMetrics.length;
    return {
      cpu: { usage: avg.cpu.usage / count, loadAverage: [] },
      memory: { usage: avg.memory.usage / count } as any,
      nlp: {
        averageProcessingTime: avg.nlp.averageProcessingTime / count,
        documentsProcessed: this.nlpMetrics.documentsProcessed,
      } as any,
    };
  }

  getSystemInfo(): {
    platform: string;
    arch: string;
    nodeVersion: string;
    cpuCount: number;
    totalMemory: string;
    hostname: string;
  } {
    return {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      cpuCount: os.cpus().length,
      totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`,
      hostname: os.hostname(),
    };
  }

  generateReport(): string {
    const current = this.getCurrentMetrics();
    const avg5min = this.getAverageMetrics(5);
    const sysInfo = this.getSystemInfo();

    if (!current) {
      return 'No metrics available';
    }

    return `
📊 NLP System Resource Report
═══════════════════════════════

🖥️ System Information:
   Platform: ${sysInfo.platform} (${sysInfo.arch})
   Node.js: ${sysInfo.nodeVersion}
   CPUs: ${sysInfo.cpuCount}
   Total Memory: ${sysInfo.totalMemory}
   Hostname: ${sysInfo.hostname}

⚡ Current Performance:
   CPU Usage: ${current.cpu.usage.toFixed(1)}%
   Memory Usage: ${current.memory.usage}% (${current.memory.used}MB / ${current.memory.total}MB)
   Heap Usage: ${current.memory.heapUsed}MB / ${current.memory.heapTotal}MB
   Load Average: ${current.cpu.loadAverage.map((l) => l.toFixed(2)).join(', ')}

🤖 NLP Processing:
   Documents Processed: ${current.nlp.documentsProcessed}
   Average Processing Time: ${current.nlp.averageProcessingTime.toFixed(0)}ms
   Active Workers: ${current.nlp.activeWorkers}
   Queued Tasks: ${current.nlp.queuedTasks}
   Models Loaded: ${current.nlp.modelsLoaded}
   Cache Hit Rate: ${current.nlp.cacheHitRate.toFixed(1)}%

📈 5-Minute Averages:
   CPU: ${avg5min.cpu?.usage?.toFixed(1) || 'N/A'}%
   Memory: ${avg5min.memory?.usage?.toFixed(1) || 'N/A'}%
   Processing Time: ${avg5min.nlp?.averageProcessingTime?.toFixed(0) || 'N/A'}ms

🕒 Uptime: ${Math.floor(current.process.uptime / 3600)}h ${Math.floor((current.process.uptime % 3600) / 60)}m
`;
  }

  dispose(): void {
    this.stop();
    this.metrics = [];
    this.removeAllListeners();
  }
}

export { ResourceMonitor };
export type { ResourceMetrics, ResourceAlert, MonitoringConfig };
