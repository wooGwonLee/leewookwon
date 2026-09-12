import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";

export const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
export const MARKET_ITEM_IMAGES_DIR = path.join(UPLOADS_ROOT, "market-items");

export function ensureUploadDirs(): void {
  fs.mkdirSync(MARKET_ITEM_IMAGES_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 5;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, MARKET_ITEM_IMAGES_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

export const uploadMarketItemImages = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: MAX_FILES_PER_UPLOAD },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error("Only JPEG, PNG, WEBP, or GIF images are allowed"));
      return;
    }
    cb(null, true);
  },
}).array("images", MAX_FILES_PER_UPLOAD);
