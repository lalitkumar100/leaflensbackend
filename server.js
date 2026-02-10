const express = require("express");
const multer = require("multer");
const cors = require("cors");
const dotenv = require("dotenv");
// const fs = require("fs"); // <--- You no longer need 'fs' for file handling
const { GoogleGenerativeAI } = require("@google/generative-ai");
const morgan = require("morgan");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// --- FIX 1: USE MEMORY STORAGE INSTEAD OF DISK ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- CHAT ENDPOINT (Unchanged) ---
app.post("/chat", async (req, res) => {
  try {
    const { message, reportContext = {}, history = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash", // Updated to latest stable flash model if needed
      systemInstruction: `You are an expert AI Plant Doctor.

Plant: ${reportContext.plantName || "Unknown"}
Disease: ${reportContext.disease || "Unknown"}
Severity: ${reportContext.severity || "N/A"}
Health Score: ${reportContext.healthScore || "N/A"}%

Rules:
- Only answer plant-health related questions.
- If unrelated, say: "I can only help with plant health questions."
- Use simple markdown formatting.`
    });

    let formattedHistory = history
      .filter(m => m?.content)
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }));

    if (formattedHistory.length > 0 && formattedHistory[0].role !== "user") {
      formattedHistory.shift();
    }

    const chat = model.startChat({ history: formattedHistory });
    const result = await chat.sendMessage(message);
    const reply = result.response.text();

    res.json({ reply });

  } catch (err) {
    console.error("Chat Error:", err.message);
    res.status(500).json({ error: "Chat service unavailable" });
  }
});

// --- FIX 2: UPDATE ANALYZE ENDPOINT ---
app.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    // Check if file exists
    if (!req.file) {
      return res.status(400).json({ error: "No image file uploaded" });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // --- FIX 3: READ DIRECTLY FROM BUFFER ---
    // Since we use memoryStorage, the data is in req.file.buffer
    const base64Image = req.file.buffer.toString("base64");
    
    const language = req.body.language || "en";

    const result = await model.generateContent([
      {
        text: `You are a plant disease AI. Analyze this leaf image and return ONLY JSON in this structure: if it not img of plant leaf, respond with empty values with "isPlantLeaf": false.and a message "Not a plant leaf image". The JSON structure is: and use ${language} for any text in the response (like disease name, care tips, etc.): but label the keys in English.

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
}`
      },
      {
        inlineData: {
          mimeType: req.file.mimetype,
          data: base64Image,
        },
      },
    ]);
  
    const text = result.response.text();
    // Improved regex to handle potential markdown code blocks provided by Gemini
    const cleaned = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/)[0];
    const parsed = JSON.parse(cleaned);

    // --- FIX 4: REMOVE UNLINK (No file was saved to disk) ---
    // fs.unlinkSync(req.file.path); <--- DELETED

    if(parsed.isPlantLeaf === false){
      return res.status(409).json({ error: "Not a plant leaf image" });
    }
    res.status(200).json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI analysis failed" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
