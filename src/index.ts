/**
 * The Agora — Entry Point
 *
 * Agent deliberation forum for the Trancendos mesh. Provides structured
 * discussion threads, proposals, voting, and consensus mechanisms to
 * enable collective decision-making across all agents.
 *
 * Port: 3017
 */

import { ForumEngine } from './forum/forum-engine';
import { createServer } from './api/server';
import { logger } from './utils/logger';

const PORT = parseInt(process.env.PORT || '3017', 10);

async function bootstrap(): Promise<void> {
  logger.info('The Agora starting up...');

  // ── Initialize Forum Engine ─────────────────────────────────────────────
  const engine = new ForumEngine();
  const stats = engine.getStats();
  logger.info(
    {
      threads: stats.totalThreads,
      proposals: stats.totalProposals,
      participants: stats.activeParticipants,
    },
    'ForumEngine initialized with seed content'
  );

  // ── Start HTTP Server ───────────────────────────────────────────────────
  const app = createServer(engine);

  const server = app.listen(PORT, () => {
    logger.info({ port: PORT }, 'The Agora API server listening');
  });

  // ── Periodic Forum Summary (every 5 minutes) ────────────────────────────
  setInterval(() => {
    const currentStats = engine.getStats();
    logger.info(
      {
        openThreads: currentStats.openThreads,
        openProposals: currentStats.openProposals,
        totalPosts: currentStats.totalPosts,
        activeParticipants: currentStats.activeParticipants,
      },
      'Agora activity summary'
    );
  }, 5 * 60_000);

  // ── Graceful Shutdown ───────────────────────────────────────────────────
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    server.close(() => {
      logger.info('The Agora shut down gracefully');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception in the-agora');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection in the-agora');
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Fatal error during the-agora bootstrap');
  process.exit(1);
});