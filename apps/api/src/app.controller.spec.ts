import { AppController } from './app.controller';

describe('AppController', () => {
  it('should return health status when database and redis are available', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    const redis = {
      ping: jest.fn().mockResolvedValue('PONG'),
    };

    const controller = new AppController(prisma as any, redis as any);

    await expect(controller.health()).resolves.toMatchObject({
      status: 'ok',
      dependencies: {
        database: 'ok',
        redis: 'ok',
      },
    });
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(redis.ping).toHaveBeenCalled();
  });

  it('should fail health check when database or redis is unavailable', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('database down')),
    };
    const redis = {
      ping: jest.fn().mockResolvedValue('PONG'),
    };

    const controller = new AppController(prisma as any, redis as any);

    await expect(controller.health()).rejects.toThrow('Database or Redis unavailable');
  });
});
