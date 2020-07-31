import { parse as parseRedisInfo } from 'redis-info';
import Hapi, { Plugin } from '@hapi/hapi';
// @ts-ignore
import packageJson from '../package.json';

interface PluginOptions {
  path?: string;
  queues: any[];
  routeOptions?: Hapi.RouteOptions;
}

export interface ValidMetrics {
  total_system_memory: string
  redis_version: string
  used_memory: string
  mem_fragmentation_ratio: string
  connected_clients: string
  blocked_clients: string
}

type MetricName = keyof ValidMetrics;

const metrics: MetricName[] = [
  'redis_version',
  'used_memory',
  'mem_fragmentation_ratio',
  'connected_clients',
  'blocked_clients',
];

const statuses = [
  'active',
  'completed',
  'delayed',
  'failed',
  'paused',
  'waiting',
];

const formatJob = (job: any) => {
  const jobProps = job.toJSON()

  return {
    id: jobProps.id,
    timestamp: jobProps.timestamp,
    processedOn: jobProps.processedOn,
    finishedOn: jobProps.finishedOn,
    progress: jobProps.progress,
    attempts: jobProps.attemptsMade,
    delay: job.opts.delay,
    failedReason: jobProps.failedReason,
    stacktrace: jobProps.stacktrace,
    opts: jobProps.opts,
    data: jobProps.data,
    name: jobProps.name,
  }
};

class QueuesController {
  options: PluginOptions;
  constructor(options: PluginOptions) {
    this.options = options;
  }
  async index(request: Hapi.Request, h: Hapi.ResponseToolkit) {
    const {
      queues,
    } = this.options;
    if (queues.length == 0) {
      return {
        stats: {},
        queues: [],
      }
    }

    const query = request.query || {};

    const redisClient = await queues[0].client;
    const redisInfoRaw = await redisClient.info();
    const redisInfo = parseRedisInfo(redisInfoRaw);

    const stats = metrics.reduce((acc, metric) => {
      if (redisInfo[metric]) {
        acc[metric] = redisInfo[metric];
      }
  
      return acc;
    }, {} as Record<MetricName, string>);
  
    // eslint-disable-next-line @typescript-eslint/camelcase
    stats.total_system_memory = redisInfo.total_system_memory || redisInfo.maxmemory;

    const data = await Promise.all(queues.map(async queue => {
      const counts = queue.getJobCounts(...statuses);
      const status = query[queue.name] === 'latest' ? statuses : query[queue.name];
      const jobs = await queue.getJobs(status, 0, 10);

      return {
        name: queue.name,
        counts,
        jobs: jobs.map(formatJob),
      };
    }));

    return {
      stats,
      data,
    };
  }
  async retryAll(request: Hapi.Request, h: Hapi.ResponseToolkit) {
  }
  async retry(request: Hapi.Request, h: Hapi.ResponseToolkit) {
  }
  async promote(request: Hapi.Request, h: Hapi.ResponseToolkit) {
  }
  async clean(request: Hapi.Request, h: Hapi.ResponseToolkit) {
  }
};

class Internals {
  options: PluginOptions;
  constructor(options: PluginOptions) {
    this.options = options;
  }
  async onPostStart(server: Hapi.Server) {
    const basePath = this.options.path;

    const controller = new QueuesController(this.options);

    server.route([
      {
        method: 'GET',
        path: `${basePath}/queues`,
        handler: controller.index,
        options: {
          ...this.options.routeOptions,
        },
      },
      {
        method: 'PUT',
        path: `${basePath}/queues/retry`,
        handler: controller.retryAll,
        options: {
          ...this.options.routeOptions,
        },
      },
      {
        method: 'PUT',
        path: `${basePath}/queues/{queue}/retry`,
        handler: controller.retry,
        options: {
          ...this.options.routeOptions,
        },
      },
      {
        method: 'PUT',
        path: `${basePath}/queues/{queue}/promote`,
        handler: controller.promote,
        options: {
          ...this.options.routeOptions,
        },
      },
      {
        method: 'PUT',
        path: `${basePath}/queues/{queue}/clean/{status}`,
        handler: controller.clean,
        options: {
          ...this.options.routeOptions,
        },
      },
    ]);
  }
}

const plugin: Hapi.Plugin<PluginOptions> = {
  register(server: Hapi.Server, options: PluginOptions) {
    const internals = new Internals(options);
    server.ext({
      type: 'onPostStart',
      method: internals.onPostStart.bind(internals),
    });
  },
  pkg: {
    name: packageJson.name,
    version: packageJson.version,
  },
};

export default plugin;