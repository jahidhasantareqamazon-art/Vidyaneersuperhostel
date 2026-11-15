import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { bookingFormSchema, createSubmissionSignature, inquiryFormSchema } from './src/utils/validation.ts';

interface PendingStore {
  bookings: Array<{
    id: string;
    bookingCode: string;
    studentName: string;
    mobile: string;
    guardianMobile: string;
    institution: string;
    roomId: string;
    roomType: string;
    occupants: number;
    preferredDate: string;
    message?: string;
    status: 'pending';
    createdAt: string;
    updatedAt: string;
  }>;
  inquiries: Array<{
    id: string;
    senderName: string;
    phone: string;
    subject: string;
    message: string;
    status: 'new';
    createdAt: string;
  }>;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_PATH = path.join(DATA_DIR, 'pending_sync.json');

function loadStore(): PendingStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as PendingStore;
    }
  } catch {
    // ignore corrupt fallback file
  }
  return { bookings: [], inquiries: [] };
}

function saveStore(store: PendingStore): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function rateLimit(maxHits: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const record = rateLimitMap.get(key);
    if (!record || record.resetAt < now) {
      rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (record.count >= maxHits) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    }
    record.count += 1;
    return next();
  };
}

async function startServer() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '64kb' }));

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'bidya-neer-super-hostel' });
  });

  app.get('/robots.txt', (req, res) => {
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    res.type('text/plain').send(
      `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${baseUrl}/sitemap.xml\n`
    );
  });

  app.get('/sitemap.xml', (req, res) => {
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const routes = ['/', '/about', '/rooms', '/facilities', '/gallery', '/booking', '/contact'];
    const urls = routes
      .map(
        (route) =>
          `  <url>\n    <loc>${baseUrl}${route}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>${route === '/' ? '1.0' : '0.8'}</priority>\n  </url>`
      )
      .join('\n');
    res
      .type('application/xml')
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
  });

  app.post('/api/bookings', rateLimit(15, 60_000), (req, res) => {
    const parsed = bookingFormSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid booking input', issues: parsed.error.issues });
    }

    const id = typeof req.body?.id === 'string' && /^[a-zA-Z0-9_\-]{3,128}$/.test(req.body.id)
      ? req.body.id
      : `bk-${Date.now()}`;
    const bookingCode =
      typeof req.body?.bookingCode === 'string' && /^[A-Z0-9\-]{6,32}$/.test(req.body.bookingCode)
        ? req.body.bookingCode
        : `BH-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const roomType = typeof req.body?.roomType === 'string' ? req.body.roomType.slice(0, 100) : parsed.data.roomId;

    const store = loadStore();
    const sig = createSubmissionSignature(parsed.data.mobile, parsed.data.roomId, parsed.data.preferredDate);
    const duplicate = store.bookings.find(
      (b) => createSubmissionSignature(b.mobile, b.roomId, b.preferredDate) === sig
    );
    if (duplicate) {
      return res.status(409).json({
        code: 'DUPLICATE_BOOKING',
        error: 'A booking with these details was already submitted.',
      });
    }

    const now = new Date().toISOString();
    const record = {
      id,
      bookingCode,
      ...parsed.data,
      roomType,
      status: 'pending' as const,
      createdAt: now,
      updatedAt: now,
    };
    store.bookings.unshift(record);
    saveStore(store);

    return res.status(201).json({
      bookingCode: record.bookingCode,
      roomType: record.roomType,
      preferredDate: record.preferredDate,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  });

  app.get('/api/booking-status/:code', (req, res) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const store = loadStore();
    const found = store.bookings.find((b) => b.bookingCode === code);
    if (!found) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    return res.json({
      bookingCode: found.bookingCode,
      roomType: found.roomType,
      preferredDate: found.preferredDate,
      status: found.status,
      createdAt: found.createdAt,
      updatedAt: found.updatedAt,
    });
  });

  app.post('/api/inquiries', rateLimit(15, 60_000), (req, res) => {
    const parsed = inquiryFormSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid inquiry input', issues: parsed.error.issues });
    }
    const id = typeof req.body?.id === 'string' && /^[a-zA-Z0-9_\-]{3,128}$/.test(req.body.id)
      ? req.body.id
      : `inq-${Date.now()}`;
    const store = loadStore();
    store.inquiries.unshift({
      id,
      ...parsed.data,
      status: 'new',
      createdAt: new Date().toISOString(),
    });
    saveStore(store);
    return res.status(201).json({ ok: true, id });
  });

  app.get('/api/pending-sync', (_req, res) => {
    const store = loadStore();
    res.json(store);
  });

  app.post('/api/pending-sync/clear', (_req, res) => {
    saveStore({ bookings: [], inquiries: [] });
    res.json({ ok: true });
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Bidya Neer Super Hostel server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
