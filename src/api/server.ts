/**
 * The Agora — REST API Server
 *
 * Exposes threads, posts, proposals, voting, and consensus
 * mechanisms over HTTP.
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { ForumEngine } from '../forum/forum-engine';
import { logger } from '../utils/logger';

export function createServer(engine: ForumEngine): express.Application {
  const app = express();

  // ── Middleware ────────────────────────────────────────────────────────────
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(morgan('combined', {
    stream: { write: (msg: string) => logger.info(msg.trim()) },
  }));

  // ── Health & Metrics ──────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    const stats = engine.getStats();
    res.json({
      status: 'healthy',
      service: 'the-agora',
      timestamp: new Date().toISOString(),
      threads: stats.totalThreads,
      proposals: stats.totalProposals,
    });
  });

  app.get('/metrics', (_req: Request, res: Response) => {
    const stats = engine.getStats();
    res.json({
      service: 'the-agora',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      stats,
    });
  });

  // ── Threads ───────────────────────────────────────────────────────────────

  /** GET /threads — list threads with optional filters */
  app.get('/threads', (req: Request, res: Response) => {
    const { category, status, authorId, tag, pinned, limit } = req.query;
    const threads = engine.getThreads({
      category: category as any,
      status: status as any,
      authorId: authorId as string,
      tag: tag as string,
      pinned: pinned !== undefined ? pinned === 'true' : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });
    res.json({ threads, total: threads.length });
  });

  /** POST /threads — create a new thread */
  app.post('/threads', (req: Request, res: Response) => {
    try {
      const { title, category, authorId, initialPost, tags } = req.body;
      if (!title || !category || !authorId || !initialPost) {
        return res.status(400).json({ error: 'title, category, authorId, and initialPost are required' });
      }
      const thread = engine.createThread({ title, category, authorId, initialPost, tags });
      logger.info({ threadId: thread.id, title: thread.title }, 'Thread created via API');
      res.status(201).json({ thread });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** GET /threads/:id — get a specific thread */
  app.get('/threads/:id', (req: Request, res: Response) => {
    const thread = engine.getThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    res.json({ thread });
  });

  /** PATCH /threads/:id/status — update thread status */
  app.patch('/threads/:id/status', (req: Request, res: Response) => {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });
    const thread = engine.updateThreadStatus(req.params.id, status);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    res.json({ thread });
  });

  /** PATCH /threads/:id/pin — pin or unpin a thread */
  app.patch('/threads/:id/pin', (req: Request, res: Response) => {
    const { pinned } = req.body;
    const thread = engine.pinThread(req.params.id, pinned !== false);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    res.json({ thread });
  });

  // ── Posts ─────────────────────────────────────────────────────────────────

  /** GET /threads/:id/posts — get all posts in a thread */
  app.get('/threads/:id/posts', (req: Request, res: Response) => {
    const thread = engine.getThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    res.json({ posts: thread.posts, total: thread.posts.length });
  });

  /** POST /threads/:id/posts — add a post to a thread */
  app.post('/threads/:id/posts', (req: Request, res: Response) => {
    try {
      const { authorId, content, replyToId } = req.body;
      if (!authorId || !content) {
        return res.status(400).json({ error: 'authorId and content are required' });
      }
      const post = engine.addPost({ threadId: req.params.id, authorId, content, replyToId });
      if (!post) return res.status(400).json({ error: 'Cannot post to this thread (locked/archived or not found)' });
      logger.info({ postId: post.id, threadId: req.params.id }, 'Post added via API');
      res.status(201).json({ post });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** PATCH /threads/:threadId/posts/:postId — edit a post */
  app.patch('/threads/:threadId/posts/:postId', (req: Request, res: Response) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    const post = engine.editPost(req.params.threadId, req.params.postId, content);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ post });
  });

  /** POST /threads/:threadId/posts/:postId/react — react to a post */
  app.post('/threads/:threadId/posts/:postId/react', (req: Request, res: Response) => {
    const { authorId, emoji } = req.body;
    if (!authorId || !emoji) return res.status(400).json({ error: 'authorId and emoji are required' });
    const post = engine.reactToPost(req.params.threadId, req.params.postId, authorId, emoji);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ post });
  });

  // ── Proposals ─────────────────────────────────────────────────────────────

  /** GET /proposals — list proposals with optional filters */
  app.get('/proposals', (req: Request, res: Response) => {
    const { status, authorId, limit } = req.query;
    const proposals = engine.getProposals({
      status: status as any,
      authorId: authorId as string,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });
    res.json({ proposals, total: proposals.length });
  });

  /** POST /proposals — create a new proposal */
  app.post('/proposals', (req: Request, res: Response) => {
    try {
      const { title, description, authorId, consensusMethod, quorum, threshold, deadline, threadId } = req.body;
      if (!title || !description || !authorId) {
        return res.status(400).json({ error: 'title, description, and authorId are required' });
      }
      const proposal = engine.createProposal({
        title, description, authorId, consensusMethod, quorum, threshold,
        deadline: deadline ? new Date(deadline) : undefined,
        threadId,
      });
      logger.info({ proposalId: proposal.id, title: proposal.title }, 'Proposal created via API');
      res.status(201).json({ proposal });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** GET /proposals/:id — get a specific proposal */
  app.get('/proposals/:id', (req: Request, res: Response) => {
    const proposal = engine.getProposal(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
    res.json({ proposal });
  });

  /** POST /proposals/:id/open — open a proposal for discussion */
  app.post('/proposals/:id/open', (req: Request, res: Response) => {
    const proposal = engine.openProposal(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
    res.json({ proposal });
  });

  /** POST /proposals/:id/voting — start voting on a proposal */
  app.post('/proposals/:id/voting', (req: Request, res: Response) => {
    const proposal = engine.startVoting(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
    res.json({ proposal });
  });

  /** POST /proposals/:id/votes — cast a vote */
  app.post('/proposals/:id/votes', (req: Request, res: Response) => {
    try {
      const { voterId, vote, weight, rationale } = req.body;
      if (!voterId || !vote) {
        return res.status(400).json({ error: 'voterId and vote are required' });
      }
      const castVote = engine.castVote({ proposalId: req.params.id, voterId, vote, weight, rationale });
      if (!castVote) return res.status(400).json({ error: 'Cannot vote — proposal not in voting state or not found' });
      logger.info({ proposalId: req.params.id, voterId, vote }, 'Vote cast via API');
      res.status(201).json({ vote: castVote });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /proposals/:id/finalize — finalize and calculate consensus */
  app.post('/proposals/:id/finalize', (req: Request, res: Response) => {
    const result = engine.finalizeProposal(req.params.id);
    if (!result) return res.status(404).json({ error: 'Proposal not found' });
    logger.info({ proposalId: req.params.id, result: result.status }, 'Proposal finalized via API');
    res.json({ result });
  });

  /** POST /proposals/:id/implement — mark proposal as implemented */
  app.post('/proposals/:id/implement', (req: Request, res: Response) => {
    const proposal = engine.markImplemented(req.params.id);
    if (!proposal) return res.status(400).json({ error: 'Proposal not found or not in approved state' });
    res.json({ proposal });
  });

  /** POST /proposals/:id/withdraw — withdraw a proposal */
  app.post('/proposals/:id/withdraw', (req: Request, res: Response) => {
    const proposal = engine.withdrawProposal(req.params.id);
    if (!proposal) return res.status(400).json({ error: 'Proposal not found or cannot be withdrawn' });
    res.json({ proposal });
  });

  /** GET /proposals/:id/consensus — get current consensus result */
  app.get('/proposals/:id/consensus', (req: Request, res: Response) => {
    const result = engine.getConsensusResult(req.params.id);
    if (!result) return res.status(404).json({ error: 'Proposal not found' });
    res.json({ result });
  });

  // ── Stats ─────────────────────────────────────────────────────────────────

  /** GET /stats — get agora statistics */
  app.get('/stats', (_req: Request, res: Response) => {
    const stats = engine.getStats();
    res.json({ stats });
  });

  // ── Error Handler ─────────────────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, 'Unhandled error in the-agora API');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}