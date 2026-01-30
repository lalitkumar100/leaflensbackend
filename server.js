const express = require("express");
const multer = require("multer");
const cors = require("cors");
const dotenv = require("dotenv");
const morgan = require("morgan");
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(morgan("dev"));

// Memory storage for Vercel
const upload = multer({ storage: multer.memoryStorage() });

// Gemini Init
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);



// ================= CHAT ENDPOINT =================
app.post("/chat", async (req, res) => {
  try {
    const { message, reportContext = {}, history = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    const {
      plantName = "Unknown Plant",
      disease = "Unknown Issue",
      severity = "Unknown",
      healthScore = "N/A",
    } = reportContext;

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: `You are an expert AI Plant Doctor.

User plant: ${plantName}
Disease: ${disease}
Severity: ${severity}
Health Score: ${healthScore}%

Rules:
- Only answer plant-related questions
- Refuse unrelated topics politely
- Use markdown formatting`,
    });

    const chatSession = model.startChat({
      history: history.map((msg) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      })),
    });

    const result = await chatSession.sendMessage(message);

    res.status(200).json({ reply: result.response.text() });
  } catch (err) {
    console.error("Chat Error:", err);
    res.status(500).json({ error: "Plant Doctor unavailable" });
  }
});



// ================= IMAGE ANALYSIS =================
app.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const base64Image = req.file.buffer.toString("base64");

    const prompt = `
Analyze this image.

Return ONLY valid JSON. No text. No markdown.

{
  "isPlantLeaf": false,
  "plantName": "",
  "scientificName": "",
  "family": "",
  "confidence": 0,
  "healthScore": 0,
  "riskLevel": "",
  "disease": "",
  "severity": "",
  "affectedParts": [],
  "diseaseDuration": "",
  "symptoms": [],
  "treatment": {
    "immediate": [],
    "remedies": [],
    "duration": "",
    "successRate": 0
  },
  "careGuide": {
    "watering": "",
    "sunlight": "",
    "soil": "",
    "fertilizer": "",
    "temperature": ""
  },
  "preventionTips": [],
  "notes": ""
}
`;

    const result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          mimeType: req.file.mimetype,
          data: base64Image,
        },
      },
    ]);

    const text = result.response.text();

    // Safe JSON extraction
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: "AI returned invalid format" });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.isPlantLeaf) {
      return res.status(409).json({ error: "Not a plant leaf image" });
    }

    res.status(200).json(parsed);
  } catch (err) {
    console.error("Analyze Error:", err);
    res.status(500).json({ error: "AI analysis failed" });
  }
});



// ✅ EXPORT FOR VERCEL SERVERLESS
module.exports = app;
