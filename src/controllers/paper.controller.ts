import { Request, Response } from "express";
import { Paper } from "../models/Paper.js";
import { getMongoClientDb } from "../lib/db.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadPdfBuffer } from "../utils/cloudinary.js";
import { extractPdfText } from "../utils/pdfExtract.js";

/**
 * POST /api/papers  (protected)
 * Handles the "Add Paper" form. File comes in via multer (memory storage).
 * New papers always start as "pending" until an admin approves them.
 */
export const createPaper = asyncHandler(async (req: Request, res: Response) => {
  const { title, abstract, authors, field } = req.body;

  if (!req.file) {
    return res.status(400).json({ message: "PDF file is required" });
  }
  if (!title || !abstract || !authors || !field) {
    return res.status(400).json({ message: "Title, abstract, authors, and field are required" });
  }

  const extractedText = await extractPdfText(req.file.buffer);
  const fileUrl = await uploadPdfBuffer(req.file.buffer, `${Date.now()}-${req.file.originalname}`);

  const paper = await Paper.create({
    title,
    abstract,
    field,
    authors: Array.isArray(authors) ? authors : String(authors).split(",").map((a) => a.trim()),
    fileUrl,
    extractedText,
    uploadedBy: req.user!.id,
    status: "pending",
  });

  res.status(201).json({ message: "Paper submitted for admin approval", paper });
});

/**
 * GET /api/papers  (public)
 * Powers the /explore page: search + filter (field, sort) + pagination.
 * Only approved papers are ever visible here.
 */
export const listPapers = asyncHandler(async (req: Request, res: Response) => {
  const {
    search = "",
    field = "",
    dateRange = "",
    sort = "newest",
    page = "1",
    limit = "12",
  } = req.query as Record<string, string>;

  const query: Record<string, any> = { status: "approved" };

  if (search) {
    query.$text = { $search: search };
  }
  if (field) {
    query.field = field;
  }
  if (dateRange) {
    const days: Record<string, number> = { week: 7, month: 30, year: 365 };
    if (days[dateRange]) {
      query.createdAt = { $gte: new Date(Date.now() - days[dateRange] * 24 * 60 * 60 * 1000) };
    }
  }

  // Sorting
  const sortObj = (sort === "oldest" ? { createdAt: 1 } : sort === "popular" ? { views: -1 } : { createdAt: -1 }) as Record<string, 1 | -1>;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 12));

  let papers: any[] = [];
  let total = 0;

  try {
    if (search) {
      query.$text = { $search: search };
    }

    [papers, total] = await Promise.all([
      Paper.find(query)
        .sort(sortObj as any)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .select("-extractedText"),
      Paper.countDocuments(query),
    ]);
  } catch (err) {
    console.warn("MongoDB text index search failed, falling back to regex search:", err);
    delete query.$text;

    if (search) {
      const escapedSearch = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
      query.$or = [
        { title: { $regex: escapedSearch, $options: "i" } },
        { abstract: { $regex: escapedSearch, $options: "i" } },
        { authors: { $regex: escapedSearch, $options: "i" } },
      ];
    }

    [papers, total] = await Promise.all([
      Paper.find(query)
        .sort(sortObj as any)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .select("-extractedText"),
      Paper.countDocuments(query),
    ]);
  }

  // Fallback: if Mongoose returned no papers but there are documents in
  // similarly named collections (e.g., 'paper' vs 'papers' or legacy 'items'),
  // attempt a raw query directly against the MongoDB collection so the
  // frontend doesn't receive a 500 when a simple collection-name mismatch exists.
  if (papers.length === 0 && total === 0) {
    try {
      const db = getMongoClientDb();
      const candidateCollections = ["papers", "paper", "items"];
      for (const collName of candidateCollections) {
        const exists = (await db.listCollections({ name: collName }).toArray()).length > 0;
        if (!exists) continue;

        const rawQuery: any = { ...(query as any) };
        // MongoDB driver doesn't support $text without indexes too, but we'll try.
        const cursor = db
          .collection(collName)
          .find(rawQuery)
          .sort(sortObj as any)
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum)
          .project({ extractedText: 0 });

        const rawPapers = await cursor.toArray();
        const rawTotal = await db.collection(collName).countDocuments(rawQuery);
        if (rawPapers.length > 0) {
          return res.json({
            papers: rawPapers,
            pagination: {
              page: pageNum,
              limit: limitNum,
              total: rawTotal,
              totalPages: Math.ceil(rawTotal / limitNum),
            },
          });
        }
      }
    } catch (err) {
      console.error("Fallback raw collection query failed:", err);
    }
  }

  res.json({
    papers,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });

});


/**
 * GET /api/papers/mine  (protected)
 * Powers the "Manage Papers" dashboard — shows the logged-in user's own
 * submissions regardless of status (pending/approved/rejected).
 */
export const listMyPapers = asyncHandler(async (req: Request, res: Response) => {
  const papers = await Paper.find({ uploadedBy: req.user!.id })
    .sort({ createdAt: -1 })
    .select("-extractedText");
  res.json({ papers });
});

/**
 * GET /api/papers/:id  (public, with visibility rules)
 * Approved papers are visible to everyone. Pending/rejected papers are only
 * visible to their owner or an admin (so links can't leak unapproved work).
 */
export const getPaperById = asyncHandler(async (req: Request, res: Response) => {
  const paper = await Paper.findById(req.params.id);
  if (!paper) return res.status(404).json({ message: "Paper not found" });

  const isOwner = req.user?.id === paper.uploadedBy.toString();
  const isAdmin = req.user?.role === "admin";

  if (paper.status !== "approved" && !isOwner && !isAdmin) {
    return res.status(403).json({ message: "This paper is not publicly available yet" });
  }

  if (paper.status === "approved") {
    paper.views += 1;
    await paper.save();
  }

  res.json({ paper });
});

/**
 * DELETE /api/papers/:id  (protected — owner or admin only)
 */
export const deletePaper = asyncHandler(async (req: Request, res: Response) => {
  const paper = await Paper.findById(req.params.id);
  if (!paper) return res.status(404).json({ message: "Paper not found" });

  const isOwner = req.user?.id === paper.uploadedBy.toString();
  const isAdmin = req.user?.role === "admin";
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ message: "Not allowed to delete this paper" });
  }

  await Promise.all([
    Paper.findByIdAndDelete(paper._id),
    ChatMessage.deleteMany({ paperId: paper._id }),
  ]);

  res.json({ message: "Paper deleted" });
});

/**
 * GET /api/papers/:id/related  (public)
 * Simple related-papers logic for the details page: same field, approved,
 * excluding the current paper.
 */
export const getRelatedPapers = asyncHandler(async (req: Request, res: Response) => {
  const paper = await Paper.findById(req.params.id);
  if (!paper) return res.status(404).json({ message: "Paper not found" });

  const related = await Paper.find({
    _id: { $ne: paper._id },
    field: paper.field,
    status: "approved",
  })
    .limit(4)
    .select("-extractedText");

  res.json({ papers: related });
});


/**
 * GET /api/papers/stats  (public)
 * Powers the Home page's PlatformStats section with real, live numbers —
 * no hardcoded/dummy figures.
 */
export const getPlatformStats = asyncHandler(async (_req: Request, res: Response) => {
  const [approvedPapers, fieldsAgg, viewsAgg, summariesGenerated, fieldBreakdown] = await Promise.all([
    Paper.countDocuments({ status: "approved" }),
    Paper.distinct("field", { status: "approved" }),
    Paper.aggregate([
      { $match: { status: "approved" } },
      { $group: { _id: null, total: { $sum: "$views" } } },
    ]),
    Paper.countDocuments({ status: "approved", aiSummary: { $exists: true, $ne: "" } }),
    Paper.aggregate([
      { $match: { status: "approved" } },
      { $group: { _id: "$field", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  res.json({
    approvedPapers,
    fieldsCount: fieldsAgg.length,
    totalViews: viewsAgg[0]?.total || 0,
    summariesGenerated,
    fieldBreakdown: fieldBreakdown.map((f) => ({ field: f._id, count: f.count })),
  });
});