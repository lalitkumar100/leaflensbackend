const express = require("express");
const multer = require("multer");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const morgon = require("morgan");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json()); // CRITICAL: Allows Express to read JSON sent by Axios
app.use(morgon("dev"));

const upload = multer({ dest: "uploads/" });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- NEW CHAT ENDPOINT ---
app.post("/chat", async (req, res) => {
  try {
    const { message, reportContext = {}, history = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // 🌿 Create model with plant context
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
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

    // 🧠 Format history safely for Gemini
    let formattedHistory = history
      .filter(m => m?.content)
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }));

    // ❗ Gemini rule: first message must be user
    if (formattedHistory.length > 0 && formattedHistory[0].role !== "user") {
      formattedHistory.shift();
    }

    // 💬 Start chat session
    const chat = model.startChat({ history: formattedHistory });

    // 🚀 Send new message
    const result = await chat.sendMessage(message);
    const reply = result.response.text();

    res.json({ reply });

  } catch (err) {
    console.error("Chat Error:", err.message);
    res.status(500).json({ error: "Chat service unavailable" });
  }
});


// --- EXISTING ANALYZE ENDPOINT ---
app.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const imageBuffer = fs.readFileSync(req.file.path);
    const base64Image = imageBuffer.toString("base64");
    const language = req.body.language || "en"; // Default to English if not provided
    const result = await model.generateContent([
      {
        text: `You are a plant disease AI. Analyze this leaf image and return ONLY JSON in this structure: if it not img of plant leaf, respond with empty values with "isPlantLeaf": false.and a message "Not a plant leaf image". The JSON structure is: and  use ${language} for any text in the response (like disease name, care tips, etc.): but label the keys in English.

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
    const cleaned = text.match(/\{[\s\S]*\}/)[0];
    const parsed = JSON.parse(cleaned);

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    if(parsed.isPlantLeaf === false){
      return res.status(409).json({ error: "Not a plant leaf image" });
    }
    res.status(200).json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI analysis failed" });
  }
});

app.listen(5000, () => console.log("🚀 Server running on port 5000"));
