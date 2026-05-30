import express from "express";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";
// import { createServer as createViteServer } from "vite";
import { 
  processStudyMaterialBackend, 
  generateQuizBackend, 
  askAITutorBackend, 
  processYouTubeVideoBackend, 
  generatePuzzleBatchBackend 
} from "./src/services/gemini_backend";

dotenv.config();

// Debug environment at startup
console.log("Starting server with environment check:");
console.log("- NODE_ENV:", process.env.NODE_ENV);
console.log("- GEMINI_API_KEY presence:", !!process.env.GEMINI_API_KEY);
if (process.env.GEMINI_API_KEY) {
  console.log("- GEMINI_API_KEY length:", process.env.GEMINI_API_KEY.length);
  console.log("- GEMINI_API_KEY prefix:", process.env.GEMINI_API_KEY.substring(0, 4));
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // API Routes
  app.post("/api/gemini/process-material", async (req, res) => {
    try {
      const { fileData, examType, secondaryDetails } = req.body;
      const result = await processStudyMaterialBackend(fileData, examType, secondaryDetails);
      res.json(result);
    } catch (error: any) {
      console.error("API Error (process-material):", error);
      res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });

  app.post("/api/gemini/generate-quiz", async (req, res) => {
    try {
      const { content, examType, secondaryDetails } = req.body;
      const result = await generateQuizBackend(content, examType, secondaryDetails);
      res.json(result);
    } catch (error: any) {
      console.error("API Error (generate-quiz):", error);
      res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });

  app.post("/api/gemini/ask-tutor", async (req, res) => {
    try {
      const { topic, examType, secondaryDetails } = req.body;
      const result = await askAITutorBackend(topic, examType, secondaryDetails);
      res.json(result);
    } catch (error: any) {
      console.error("API Error (ask-tutor):", error);
      res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });

  app.post("/api/gemini/process-youtube", async (req, res) => {
    try {
      const { url, examType, secondaryDetails } = req.body;
      const result = await processYouTubeVideoBackend(url, examType, secondaryDetails);
      res.json(result);
    } catch (error: any) {
      console.error("API Error (process-youtube):", error);
      res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });

  app.post("/api/gemini/puzzle-batch", async (req, res) => {
    try {
      const { examType, secondaryDetails, recentLearnings } = req.body;
      const result = await generatePuzzleBatchBackend(examType, secondaryDetails, recentLearnings);
      res.json(result);
    } catch (error: any) {
      console.error("API Error (puzzle-batch):", error);
      res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });

  // Frontend routes
  const isProduction = process.env.NODE_ENV === "production";

  if (!isProduction) {
    console.log("Starting in development mode with Vite middleware...");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting in production mode...");
    const distPath = path.resolve(process.cwd(), "dist");
    
    // Serve static files from the dist directory
    app.use(express.static(distPath));
    
    // Handle SPA routing
    app.get("*", (req, res) => {
      const indexPath = path.join(distPath, "index.html");
      res.sendFile(indexPath, (err) => {
        if (err) {
          console.error("Error sending index.html:", err);
          res.status(500).send("Application shell not found. Please ensure the build completed successfully.");
        }
      });
    });
  }

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled Error:", err);
    res.status(500).json({ error: "An unexpected error occurred." });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
