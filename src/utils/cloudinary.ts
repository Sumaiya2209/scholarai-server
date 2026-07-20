import { v2 as cloudinary } from "cloudinary";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const cloudApiKey = process.env.CLOUDINARY_API_KEY;
const cloudApiSecret = process.env.CLOUDINARY_API_SECRET;

let cloudinaryConfigured = true;
if (!cloudName || !cloudApiKey || !cloudApiSecret) {
  cloudinaryConfigured = false;
  console.warn("⚠️ Cloudinary credentials are missing — uploads will fail until CLOUDINARY_* env vars are set.");
} else {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: cloudApiKey,
    api_secret: cloudApiSecret,
  });
}

/**
 * Uploads a PDF buffer (from multer's memory storage) to Cloudinary
 * as a "raw" resource, since PDFs aren't images/video.
 */
export function uploadPdfBuffer(buffer: Buffer, filename: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!cloudinaryConfigured) return reject(new Error("Cloudinary not configured (missing CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET/CLOUDINARY_CLOUD_NAME)"));
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder: "scholarai/papers",
        public_id: filename.replace(/\.pdf$/i, ""),
        format: "pdf",
      },
      (error, result) => {
        if (error || !result) return reject(error);
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

export default cloudinary;
