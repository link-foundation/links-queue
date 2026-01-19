# links-queue-nestjs

NestJS module for [Links Queue](https://github.com/link-foundation/links-queue).

## Installation

```bash
npm install links-queue-nestjs
```

## Quick Start

### Module Registration

```typescript
import { Module } from '@nestjs/common';
import { LinksQueueModule } from 'links-queue-nestjs';

@Module({
  imports: [LinksQueueModule.forRoot({ mode: 'single-memory' })],
})
export class AppModule {}
```

### Using the Service

```typescript
import { Injectable } from '@nestjs/common';
import { LinksQueueService } from 'links-queue-nestjs';

@Injectable()
export class TaskService {
  constructor(private readonly queueService: LinksQueueService) {}

  async addTask(task: unknown) {
    return this.queueService.enqueue('tasks', task);
  }

  async processTask() {
    const task = await this.queueService.dequeue('tasks');
    if (task) {
      // Process task
      await this.queueService.acknowledge('tasks', task.id);
    }
    return task;
  }
}
```

## Configuration Options

### Synchronous Configuration

```typescript
LinksQueueModule.forRoot({
  // Queue mode: 'single-memory' (default) or 'single-stored'
  mode: 'single-memory',

  // Whether module is global (default: true)
  isGlobal: true,

  // Or provide a custom queue manager
  queueManager: myCustomManager,
});
```

### Async Configuration

```typescript
import { ConfigService } from '@nestjs/config';

LinksQueueModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (configService: ConfigService) => ({
    mode: configService.get('QUEUE_MODE') || 'single-memory',
  }),
  inject: [ConfigService],
});
```

### Feature Modules

Register specific queues in feature modules:

```typescript
import { Module } from '@nestjs/common';
import { LinksQueueModule } from 'links-queue-nestjs';

@Module({
  imports: [
    LinksQueueModule.forFeature('tasks', {
      maxSize: 1000,
      visibilityTimeout: 60,
    }),
  ],
})
export class TasksModule {}
```

## Service API

The `LinksQueueService` provides these methods:

- `createQueue(name, options?)` - Create a new queue
- `getQueue(name)` - Get an existing queue
- `getOrCreateQueue(name, options?)` - Get or create a queue
- `deleteQueue(name)` - Delete a queue
- `listQueues()` - List all queues
- `enqueue(queueName, payload, options?)` - Add item to queue
- `dequeue(queueName)` - Remove and return next item
- `peek(queueName)` - View next item without removing
- `acknowledge(queueName, messageId)` - Confirm processing
- `reject(queueName, messageId, requeue?)` - Reject item
- `getStats(queueName)` - Get queue statistics

## Example Controller

```typescript
import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { LinksQueueService } from 'links-queue-nestjs';

@Controller('tasks')
export class TasksController {
  constructor(private readonly queueService: LinksQueueService) {}

  @Post()
  async createTask(@Body() task: unknown) {
    return this.queueService.enqueue('tasks', task);
  }

  @Get()
  async getTask() {
    return this.queueService.dequeue('tasks');
  }

  @Post(':id/ack')
  async acknowledgeTask(@Param('id') id: string) {
    return this.queueService.acknowledge('tasks', id);
  }
}
```

## License

Unlicense
