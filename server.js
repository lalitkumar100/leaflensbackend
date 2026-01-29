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
    const { message, reportContext, history } = req.body;

    // 1. Initialize the model with strict System Instructions
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash", // Using 2.0 or 1.5 as 2.5 is a future version
      systemInstruction: `You are an expert AI Plant Doctor. 
      The user is asking about a specific plant diagnosis: ${reportContext.plantName} with ${reportContext.disease}.
      
      CONSTRAINTS:
      - ONLY discuss topics related to this specific plant or plant care in general.
      - If the user asks about unrelated topics (politics, sports, coding, other random things), politely say: "I am sorry, but as your Plant Doctor, I am only allowed to discuss topics related to your ${reportContext.plantName} and its health."
      - Use Markdown for your responses (bolding, lists).
      - Reference the current report data if relevant: Severity is ${reportContext.severity}, Health Score is ${reportContext.healthScore}%.`
    });

    // 2. Format history for Gemini (roles must be 'user' or 'model')
    const chatSession = model.startChat({
      history: history.map(msg => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      })),
    });

    // 3. Send the message
    const result = await chatSession.sendMessage(message);
    const responseText = result.response.text();

    res.status(200).json({ reply: responseText });

  } catch (err) {
    console.error("Chat Error:", err);
    res.status(500).json({ error: "The Plant Doctor is currently unavailable." });
  }
});

// --- EXISTING ANALYZE ENDPOINT ---
app.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const imageBuffer = fs.readFileSync(req.file.path);
    const base64Image = imageBuffer.toString("base64");

    const result = await model.generateContent([
      {
        text: `You are a plant disease AI. Analyze this leaf image and return ONLY JSON in this structure: if it not img of plant leaf, respond with empty values with "isPlantLeaf": false.

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