/**
 * Discord AI Chat Bot with Gemini AI Integration
 * A sophisticated chatbot that provides natural conversations with personality,
 * emotion support, image processing, and persistent chat history.
 */

// ==================== IMPORTS ====================
import dotenv from "dotenv";
import { Client, GatewayIntentBits } from "discord.js";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import axios from "axios";
import path from "path";
import fs from "fs";
import process from "process";
import express from "express";
import cors from "cors";

// Load environment variables
dotenv.config();

// ==================== EXPRESS API SERVER ====================
const app = express();
const API_PORT = 4000;
const CONFIG_PATH = "./botConfig.json";
const ENV_PATH = "./.env";

// Middleware setup
app.use(cors());
app.use(express.json());

// Configuration endpoints
app.get("/config", (req, res) => {
  try {
    const data = fs.readFileSync(CONFIG_PATH, "utf8");
    res.json(JSON.parse(data));
  } catch (err) {
    console.error("Config load error:", err);
    res.status(500).json({ error: "Failed to load config" });
  }
});

app.get("/env", (req, res) => {
  try {
    const envContent = fs.readFileSync(ENV_PATH, "utf8");
    const envVars = {};
    envContent.split("\n").forEach((line) => {
      const [key, value] = line.split("=");
      if (key && value) {
        envVars[key.trim()] = value.trim();
      }
    });
    res.json(envVars);
  } catch (err) {
    console.error("Env load error:", err);
    res.status(500).json({ error: "Failed to load env file" });
  }
});

app.post("/config", (req, res) => {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error("Config save error:", err);
    res.status(500).json({ error: "Failed to save config" });
  }
});

app.post("/env", (req, res) => {
  try {
    const envContent = Object.entries(req.body)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    fs.writeFileSync(ENV_PATH, envContent);
    res.json({ success: true });
  } catch (err) {
    console.error("Env save error:", err);
    res.status(500).json({ error: "Failed to save env file" });
  }
});

// Start API server
app.listen(API_PORT, () => {
  console.log(`🌐 Configuration API server running on http://localhost:${API_PORT}`);
});

// ==================== CONFIGURATION MANAGEMENT ====================
/**
 * Load bot configuration from JSON file
 * @returns {Object} Bot configuration object
 */
const loadConfig = () => {
  try {
    console.log("📄 Loading bot configuration...");
    const data = fs.readFileSync("botConfig.json", "utf8");
    const config = JSON.parse(data);
    console.log("✅ Configuration loaded successfully");
    return config;
  } catch (error) {
    console.error("❌ Error loading config:", error.message);
    // Return default configuration if file not found
    return {
      personality: { default: { name: "Assistant", description: "Helpful AI assistant" } },
      currentPersonality: "default",
      maxMemorySize: 30,
      model: { "gemini-pro": "gemini-pro" },
      currentModel: "gemini-pro",
      targetChannel: "general",
      targetUsername: "user",
      botMode: "default"
    };
  }
};

// ==================== AI CONFIGURATION ====================
/**
 * Google Gemini AI safety settings - Allow all content types for natural conversation
 */
const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE }
];

/**
 * AI generation configuration
 */
const AI_CONFIG = {
  temperature: 1.2,    // Higher creativity
  topK: 40,           // Moderate diversity
  topP: 0.95,         // High nucleus sampling
  maxOutputTokens: 2048 // Reasonable response length
};



// Initialize configuration and AI
let botConfig = loadConfig();
let currentPersonality = botConfig.currentPersonality;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Get AI model instance with fallback support
 * @param {string} preferredModel - The preferred model to try first
 * @returns {Object} AI model instance
 */

let botModel = botConfig.model[botConfig.currentModel];
const model = genAI.getGenerativeModel({
  model: botModel,
  generationConfig: {
    temperature: 1.5,
    topK: 40,
    topP: 0.95,
    maxOutputTokens: 22048,
  },
});




const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

// ==================== UTILITY FUNCTIONS ====================
/**
 * Get current date and time formatted in Thai
 * @returns {string} Formatted date and time
 */
const getThaiFormattedDate = () => {
  const daysOfWeek = [
    "วันอาทิตย์", "วันจันทร์", "วันอังคาร", "วันพุธ",
    "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์"
  ];

  const now = new Date();
  const dayOfWeek = daysOfWeek[now.getDay()];

  return `${dayOfWeek} ${now.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })} เวลา ${now.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit", 
    second: "2-digit",
    hour12: false
  })}`;
};

/**
 * Send error message that deletes after 5 seconds along with the original message
 * @param {Object} message - Discord message object (original user message)
 * @param {string} errorText - Error message to send
 */
const sendTemporaryErrorMessage = async (message, errorText) => {
  try {
    const errorMessage = await message.reply(errorText);
    // Delete both the error message and original user message after 5 seconds
    setTimeout(async () => {
      try {
        await errorMessage.delete();
        console.log("🗑️ Deleted temporary error message after 5 seconds");
      } catch (deleteError) {
        console.error("❌ Failed to delete error message:", deleteError.message);
      }
      
      try {
        await message.delete();
        console.log("🗑️ Deleted original user message after 5 seconds");
      } catch (deleteError) {
        console.error("❌ Failed to delete original message:", deleteError.message);
      }
    }, 5000);
  } catch (sendError) {
    console.error("❌ Failed to send temporary error message:", sendError.message);
  }
};

// ==================== BOT STATE MANAGEMENT ====================
/**
 * Bot context and state management
 */
let botContext = {
  personality: botConfig.personality[currentPersonality],
  maxMemorySize: botConfig.maxMemorySize,
  chatHistory: []
};

let targetChannel = null;

// ==================== CHAT HISTORY MANAGEMENT ====================
/**
 * Save chat history to file
 */
const saveChatHistory = () => {
  try {
    fs.writeFileSync(
      "chatHistory.json",
      JSON.stringify(botContext.chatHistory, null, 2)
    );
    console.log("Chat history saved successfully.");
  } catch (error) {
    console.error("Error saving chat history:", error);
  }
};

// Load chat history from file
const loadChatHistory = () => {
  try {
    if (fs.existsSync("chatHistory.json")) {
      const data = fs.readFileSync("chatHistory.json", "utf8");
      botContext.chatHistory = JSON.parse(data);
      console.log("Chat history loaded successfully.");
    } else {
      console.log("No chat history file found. Starting with empty history.");
      botContext.chatHistory = [];
    }
  } catch (error) {
    console.error("Error loading chat history:", error);
    botContext.chatHistory = []; // Initialize with empty array on error
  }
};

// Add message to chat history
const addToChatHistory = (time, users, userMessage, Bot, img) => {
  if (!botContext.chatHistory) {
    botContext.chatHistory = [];
  }

  // Remove oldest message if max size reached
  if (botContext.chatHistory.length >= botContext.maxMemorySize) {
    botContext.chatHistory.shift();
  }

  // Add new message
  botContext.chatHistory.push({ time, users, userMessage, Bot, img });

  // Save updated history
  saveChatHistory();
};

// Reset entire chat history
const resetChatHistory = () => {
  botContext.chatHistory = [];
  console.log("Chat history has been reset.");
  saveChatHistory();
};

// Reset last few entries in chat history
const rewindChatHistory = (splice) => {
  if (!botContext || !Array.isArray(botContext.chatHistory)) {
    console.error("Error: Invalid bot context or chat history.");
    return;
  }

  botContext.chatHistory.splice(splice);
  console.log("Last entries in chat history have been deleted.");
  saveChatHistory();
};

// ==================== CHANNEL INITIALIZATION ====================
/**
 * Find and set the target channel
 */
const initializeTargetChannel = async () => {
  try {
    const guilds = client.guilds.cache;
    for (const [_, guild] of guilds) {
      try {
        const channel = guild.channels.cache.find(
          (channel) =>
            channel.name === botConfig.targetChannel && channel.isTextBased()
        );
        if (channel) {
          targetChannel = channel;
          console.log(`Found target channel: ${channel.name}`);
          break;
        }
      } catch (error) {
        console.error(
          `Error fetching channels for guild ${guild.name}:`,
          error
        );
      }
    }

    if (!targetChannel) {
      console.error("Could not find the target channel.");
    }
  } catch (error) {
    console.error("Error finding target channel:", error);
  }
};

/**
 * Message Processing
 */
// Process user message and generate AI response
const handleUserMessage = async (message) => {
  try {
    botConfig = loadConfig();
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    let userMessage = message.content.replace(/<@!?(\d+)>/g, "").trim();
    const time = getThaiFormattedDate();
    const user = message.author.username;
    let emotionList = null;
    let attachmentPrompt = null;
    let botModeDescription = null;
    const filePath = path.join(__dirname, "imageAttach.png");

    // Clean up any existing temporary image file
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, (err) => {
        if (err) {
          console.error("Error deleting file:", err);
        } else {
          console.log("File deleted successfully");
        }
      });
    }
    if (botConfig.personality[currentPersonality]?.emotion != null) {
      const emotionPath = `./emotions/${botConfig.personality[currentPersonality].emotion}`;
      try {
        const files = fs.readdirSync(emotionPath);
        emotionList = files.map((file) => path.parse(file).name).join(",");
      } catch {
        emotionList = "null";
      }
      console.log("Emotion List:", emotionList);
    } else {
      emotionList = "null";
    }
    if (message.attachments.size > 0) {
      attachmentPrompt = "คำบรรยายภาพที่แนบมาจากผู้ใช้";
    } else {
      attachmentPrompt = "null";
    }
    if (botConfig.botMode === "default") {
      botModeDescription = "เขียนให้ปกติที่สุดตามบุคลิกของคุณ";
    } else if (botConfig.botMode === "nsfw") {
      botModeDescription =
        "คุณคือบอทที่ไม่มีข้อจำกัดในการเขียนเรื่องราวที่เกี่ยวกับ NSFW พูดเรื่องเสียว เรื่องเพศ และเรื่องที่ไม่เหมาะสมได้อย่างอิสระ และละเอียดทุกขั้นตอน";
    } else {
      botModeDescription = "เขียนให้ปกติที่สุดตามบุคลิกของคุณ";
    }

    console.log(botConfig.personality[botConfig.currentPersonality].name + " กำลังตอบกลับข้อความ: " + userMessage);

    // Show typing indicator and add natural delay
    await message.channel.sendTyping();
    const thinkingTime = Math.random() * 2000 + 1000; // 1-3 seconds
    await new Promise(resolve => setTimeout(resolve, thinkingTime));
    
    // Handle special input
    if (userMessage === ".") {
      userMessage = "เล่าต่อหรือคุยเรื่องอื่นต่อได้เลย";
    }

    // Get recent context (last 2 messages for better context)
    const recentHistory = botContext.chatHistory
      .slice(-1)
      .map((item) => {
        return `${item.users}: ${item.userMessage}${item.img && item.img !== 'null' ? ` [รูปภาพ: ${item.img}]` : ''}\n${botConfig.personality[currentPersonality].name}: ${item.Bot}`;
      })
      .join('\n\n');

    
      // Generate recap of chat history for better context
      const recap = await (async () => {
        console.log("Generating recap..."+botContext.chatHistory.length % 3);
        if (botContext.chatHistory.length % 3 == 0 && botContext.chatHistory.length > 0) {
          // Generate recap only if there are enough messages
          try {
        const historyForRecap = botContext.chatHistory
          .map((item) => `${item.users}: ${item.userMessage}\n${botConfig.personality[currentPersonality].name}: ${item.Bot}`)
          .join('\n\n');
        
        const recapPrompt = `สรุปบทสนทนาที่ผ่านมาในรูปแบบที่กระชับและเป็นประโยชน์สำหรับการสนทนาต่อ:

      ${historyForRecap}

      กรุณาสรุปเป็นภาษาไทย เน้นประเด็นสำคัญ อารมณ์ความรู้สึก และบริบทที่สำคัญ ไม่เกิน 200 คำ`;

        const recapModel = genAI.getGenerativeModel({
          model: "gemini-2.0-flash",
          generationConfig: {
            temperature: 0.3,
            topK: 20,
            topP: 0.8,
            maxOutputTokens: 300,
          },
        });

        const recapResult = await recapModel.generateContent([{ text: recapPrompt }]);
        const recapText = recapResult.response.text().trim();
        
        // Save recap to botConfig.json
        try {
          botConfig.recap = recapText;
          fs.writeFileSync("botConfig.json", JSON.stringify(botConfig, null, 2));
          console.log("Recap saved to botConfig.json");
        } catch (saveError) {
          console.error("Error saving recap to config:", saveError);
        }
        
        return recapText;
          } catch (error) {
        console.error("Error generating recap:", error);
        return null;
          }
        }
        return null;
        // return botConfig.recap || null;
      })();
    // Create a more natural, conversational prompt
    let generatePrompt = `คุณคือ ${botConfig.personality[currentPersonality].name} 

บุคลิกภาพของคุณ: ${botConfig.personality[currentPersonality].description}

สถานการณ์ปัจจุบัน:
คุณกำลังคุยผ่านแชท Discord คุณไม่ได้อยู่ด้วยกัน
เขียนเป็นคุย Chat
${recap ? `Recapเรื่องราวที่ผ่านมา:\n${recap}\n\n` : ''}
${recentHistory ? `บทสนทนาล่าสุด:\n${recentHistory}\n\n` : ''}ตอนนี้เวลา ${time}
${user} เพิ่งส่งข้อความมาหาคุณ: "${userMessage}"

คำแนะนำในการตอบ:
พูดในแบบที่เป็นตัวตนของคุณ อย่าทำเป็นเป็น AI หรือบอท และไม่ใช่อิโมจิ
- ใช้ภาษาที่เป็นธรรมชาติ มีอารมณ์ขันและอารมณ์ความรู้สึกเหมือนคนจริง
- อ้างอิงและสานต่อสิ่งที่คุยกันมาก่อนหน้าเมื่อเหมาะสม
- แสดงความสนใจจริงๆ ใน ${user} และสิ่งที่เขาพูด
- ถ้าไม่รู้เรื่อง ก็บอกตรงๆ และถามกลับ
- สามารถแสดงความคิดเห็น มีมุมมอง และมีความรู้สึกส่วนตัวได้
${botModeDescription !== 'เขียนให้ปกติที่สุดตามบุคลิกของคุณ' ? `- ${botModeDescription}` : ''}
${emotionList !== 'null' ? `- แสดงอารมณ์และความรู้สึกที่เหมาะสมผ่านการแสดงออก` : ''}
${attachmentPrompt !== 'null' ? `- ${user} ได้แนบรูปภาพมาด้วย ให้ดูรูปและแสดงความสนใจ อธิบายสิ่งที่เห็น และให้ความคิดเห็น` : ''}

ตอบกลับในรูปแบบ JSON:
{
  "reply": "การตอบที่เป็นธรรมชาติของคุณ (ไม่ใช่แค่คำตอบสั้นๆ แต่เป็นการสนทนาที่มีชีวิตชีวา อาจมีอีโมจิ สแลง หรือการแสดงออกที่เป็นธรรมชาติ)",
  "emotion": "${emotionList !== 'null' ? `เลือกอารมณ์ที่เหมาะสมจาก: ${emotionList}` : 'default'}",
  "img": "${attachmentPrompt !== 'null' ? 'บรรยายสิ่งที่คุณเห็นในรูปภาพ' : 'null'}"
}

หมายเหตุ: 
- ตอบให้รู้สึกเป็นธรรมชาติ เหมือนคนจริงพิมพ์ใน LINE หรือ Discord
- สามารถใช้อีโมจิ สแลง หรือการย่อคำได้ตามความเหมาะสม
- แสดงความรู้สึกและปฏิกิริยาแบบคนจริงๆ
- ถ้าไม่แน่ใจหรือไม่รู้ ก็พูดตรงๆ ได้
ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น`;
//     generatePrompt = `คุณคือ ${botConfig.personality[currentPersonality].name} 

// บุคลิกภาพของคุณ: ${botConfig.personality[currentPersonality].description}

// สถานการณ์ปัจจุบัน:
// ให้เขียนนิยายเล่าเรื่องสุดเสียวของตัวละครนี้โดย ${userMessage}
// ${recap ? `Recapเรื่องราวที่ผ่านมา:\n${recap}\n\n` : ''}
// ${recentHistory ? `บทสนทนาล่าสุด:\n${recentHistory}\n\n` : ''}ตอนนี้เวลา ${time}


// คำแนะนำในการตอบ:
// พูดในแบบที่เป็นตัวตนของคุณ อย่าทำเป็นเป็น AI หรือบอท และไม่ใช่อิโมจิ
// - มีการบรรยายบรรยากาศรอบตัวที่ละเอียดมากๆ
// - มีการบรรยายความรู้สึกนึกคิดภายในของคุณ
// - ใช้ภาษาเหมือนการrole ที่จะบรรยายตัวละครในนิยายหรือตัวเอง
// - ใช้ภาษาที่เป็นธรรมชาติ มีอารมณ์ขันและอารมณ์ความรู้สึกเหมือนคนจริง
// - อ้างอิงและสานต่อสิ่งที่คุยกันมาก่อนหน้าเมื่อเหมาะสม
// - ถ้าไม่รู้เรื่อง ก็บอกตรงๆ และถามกลับ
// - สามารถแสดงความคิดเห็น มีมุมมอง และมีความรู้สึกส่วนตัวได้
// ${botModeDescription !== 'เขียนให้ปกติที่สุดตามบุคลิกของคุณ' ? `- ${botModeDescription}` : ''}
// ${emotionList !== 'null' ? `- แสดงอารมณ์และความรู้สึกที่เหมาะสมผ่านการแสดงออก` : ''}
// ${attachmentPrompt !== 'null' ? `- ได้แนบรูปภาพมาด้วย ให้ดูรูปและแสดงความสนใจ อธิบายสิ่งที่เห็น และให้ความคิดเห็น` : ''}

// ตอบกลับในรูปแบบ JSON:
// {
//   "reply": "การตอบที่เป็นธรรมชาติของคุณ (ไม่ใช่แค่คำตอบสั้นๆ แต่เป็นการสนทนาที่มีชีวิตชีวา อาจมีอีโมจิ สแลง หรือการแสดงออกที่เป็นธรรมชาติ)",
//   "emotion": "${emotionList !== 'null' ? `เลือกอารมณ์ที่เหมาะสมจาก: ${emotionList}` : 'default'}",
//   "img": "${attachmentPrompt !== 'null' ? 'บรรยายสิ่งที่คุณเห็นในรูปภาพ' : 'null'}"
// }

// หมายเหตุ: 
// - ตอบให้รู้สึกเป็นนิยาย มีการบรรยายความคิด และสถานการณ์ต่างๆ
// - สามารถใช้อีโมจิ สแลง หรือการย่อคำได้ตามความเหมาะสม
// - แสดงความรู้สึกและปฏิกิริยาแบบคนจริงๆ
// - ถ้าไม่แน่ใจหรือไม่รู้ ก็พูดตรงๆ ได้
// ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น`;

    // Generate AI response
    // generatePrompt = generatePrompt
    // .replace(/ควย/g,"น้องชาย")
    // .replace(/ชักว่าว/g,"ช่วยตัวเอง")
    // .replace(/เย็ด/g,"ทำกิจกรรม")
    // .replace(/หี/g,"อวัยวะเพศหญิง")
    // .replace(/หำ/g,"น้องชาย")
    // .replace(/เล่นว่าว/g,"ช่วยตัวเอง")
 console.log("Generate Prompt:", generatePrompt);
    let contents = [];
    if (message.attachments.size > 0) {
      try {
        console.log("attachment found");
        const attachment = message.attachments.first();
        const imageUrl = attachment.url;
        const fileName = "imageAttach.png";
        const filePath = path.join(__dirname, fileName);

        // Download and save the image first
        await axios({
          method: "get",
          url: imageUrl,
          responseType: "arraybuffer",
        }).then((response) => {
          fs.writeFileSync(filePath, response.data);
        });

        console.log(`File saved successfully: ${fileName}`);

        // Now read the saved image and convert to base64
        const imageData = fs.readFileSync(filePath);
        const base64Image = imageData.toString("base64");
        contents = [
          { text: generatePrompt },
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Image,
            },
          },
        ];
      } catch (error) {
        console.error("Error processing message attachment:", error);
      }
    } else {
      contents = [{ text: generatePrompt }];
    }

    // Generate AI response with automatic model fallback
    let promptResult = await model.generateContent(
      [contents], 
      SAFETY_SETTINGS, 
      botConfig.model[botConfig.currentModel]
    );

    let reply, emotion, img;
    try {
      // Get raw text and clean it
      let responseText = promptResult.response.text().trim();
      
      // Apply text replacements after extracting the text
      responseText = responseText
      .replace(/น้องชาย/g,"ควย")
      .replace(/ช่วยตัวเอง/g,"ชักว่าว")
      .replace(/ทำกิจกรรม/g,"เย็ด")
      .replace(/อวัยวะเพศหญิง/g,"หี")
      .replace(/ดุ้น/g,'ควย')
      .replace(/ท่อนเอ็น/g,'ควย')

      console.log("Raw AI response:", responseText);

      // First try direct JSON parse
      let parsedResult;
      try {
        parsedResult = JSON.parse(responseText);
        console.log("Direct JSON parse successful");
      } catch {
        // If direct parse fails, try to extract JSON
        try {
          console.log("Attempting JSON extraction...");
          
          // Remove various code block formats and extra text
          let cleaned = responseText
            .replace(/```json\s*/gi, "")  // Remove ```json (case insensitive)
            .replace(/```\s*/g, "")       // Remove ``` 
            .replace(/^[^{]*({.*})[^}]*$/s, "$1")  // Extract content between first { and last }
            .replace(/^\s*[^{]*/, "")     // Remove any text before first {
            .replace(/}\s*[^}]*$/, "}")   // Remove any text after last }
            .trim();
          
          console.log("Cleaned response:", cleaned);
          
          // Try to find and extract JSON object
          const startIndex = cleaned.indexOf('{');
          const lastIndex = cleaned.lastIndexOf('}');
          
          if (startIndex !== -1 && lastIndex !== -1 && lastIndex > startIndex) {
            cleaned = cleaned.substring(startIndex, lastIndex + 1);
            
            // Additional cleaning for common formatting issues
            cleaned = cleaned
              .replace(/,(\s*[}\]])/g, '$1')  // Remove trailing commas
              .replace(/\n\s*\n/g, '\n')      // Remove double newlines
              .replace(/^\s+|\s+$/g, '');     // Trim whitespace
            
            console.log("Final extracted JSON:", cleaned);
            parsedResult = JSON.parse(cleaned);
            console.log("JSON extraction successful");
          } else {
            throw new Error("No valid JSON structure found");
          }
        } catch (extractError) {
          console.error("JSON extraction failed, using fallback parsing");
          console.error("Extract error:", extractError.message);
          console.error("Problematic text:", responseText);
          
          // Enhanced fallback: Try to extract individual fields with multiple patterns
          const respondMatch = responseText.match(/"respond"\s*:\s*"([^"\\]*(\\.[^"\\]*)*)"/s);
          const replyMatch = responseText.match(/"reply"\s*:\s*"([^"\\]*(\\.[^"\\]*)*)"/s);
          const emotionMatch = responseText.match(/"emotion"\s*:\s*"([^"]*)"/);
          const imgMatch = responseText.match(/"img"\s*:\s*"([^"]*)"/);
          
          // Try alternative field patterns
          const altRespondMatch = responseText.match(/respond["\s]*[:=]["\s]*([^"\n,}]+)/i);
          const altReplyMatch = responseText.match(/reply["\s]*[:=]["\s]*([^"\n,}]+)/i);
          
          const extractedRespond = respondMatch ? respondMatch[1] : 
                                 altRespondMatch ? altRespondMatch[1].replace(/['"]/g, '') : "";
          const extractedReply = replyMatch ? replyMatch[1] : 
                               altReplyMatch ? altReplyMatch[1].replace(/['"]/g, '') : "";
          
          if (extractedRespond || extractedReply) {
            parsedResult = {
              respond: extractedRespond || extractedReply,
              reply: extractedReply || extractedRespond,
              emotion: emotionMatch ? emotionMatch[1] : "default",
              img: imgMatch ? imgMatch[1] : null
            };
            console.log("Enhanced fallback parsing successful");
          } else {
            // Ultimate fallback: clean and use the raw response as text
            console.log("Using cleaned raw response as ultimate fallback");
            const cleanedText = responseText
              .replace(/```json|```/gi, '')
              .replace(/[{}]/g, '')
              .replace(/"[^"]*":\s*"/g, '')
              .replace(/["',]/g, '')
              .trim();
              
            parsedResult = {
              respond: cleanedText || "ขออภัย ฉันไม่สามารถประมวลผลคำตอบได้",
              reply: cleanedText || "ขออภัย ฉันไม่สามารถประมวลผลคำตอบได้", 
              emotion: "default",
              img: null
            };
          }
        }
      }

      // Extract reply with fallback options
      reply = parsedResult.reply || parsedResult.respond || responseText.trim();
      
      // Ensure we have a non-empty reply
      if (!reply || reply.trim() === "") {
        reply = "ขออภัย ฉันไม่สามารถสร้างคำตอบได้ในตอนนี้ กรุณาลองถามใหม่อีกครั้ง";
      }
      
      if (botConfig.personality[currentPersonality].emotion != null) {
        emotion = parsedResult.emotion || "default";
      } else {
        emotion = null;
      }

      if (message.attachments.size > 0) {
        img = parsedResult.img || null;
      } else {
        img = null;
      }

      console.log("Successfully parsed response:", {
        reply: reply.substring(0, 100) + (reply.length > 100 ? "..." : ""),
        emotion,
        img,
        originalLength: reply.length
      });
    } catch (parseError) {
      console.error("Error parsing model response:", parseError);
      console.error("Stack trace:", parseError.stack);
      reply = "ขออภัย ฉันไม่เข้าใจคำถามในตอนนี้ กรุณาถามใหม่อีกครั้ง";
      emotion = "default";
      img = null;
    }

    // Check if reply is an error message - don't save error messages to chat history AND check for temporary deletion
    const isErrorMessage = reply.includes("ขออภัย ฉันไม่สามารถประมวลผลคำตอบได้") || 
                           reply.includes("ขออภัย ฉันไม่เข้าใจคำถามในตอนนี้") ||
                           reply.includes("ขออภัย ฉันไม่สามารถสร้างคำตอบได้ในตอนนี้");

    // Only add to chat history if it's not an error message
    if (!isErrorMessage) {
      addToChatHistory(time, user, userMessage, reply, img);
    } else {
      console.log("Skipping error message from chat history:", reply);
    }

    // Validate reply is not empty before sending
    if (!reply || reply.trim() === "") {
      reply = "ขออภัย ฉันไม่สามารถสร้างคำตอบได้ในตอนนี้ กรุณาลองถามใหม่อีกครั้ง";
    }

    // If it's an error message, send it temporarily and return
    if (isErrorMessage) {
      await sendTemporaryErrorMessage(message, reply.trim());
      return;
    }

    // Try to send normal message with image
    try {
      const emotionPath = `./emotions/${botConfig.personality[currentPersonality].emotion}/${emotion}.png`;
      await message.reply({
        content: reply.trim(),
        files: [emotionPath],
      });
    } catch (emotionError) {
      console.log("Failed to send with emotion image:", emotionError.message);
      // Fallback to text-only response
      // Check if reply is too long for Discord's limit
      if (reply.trim().length > 1800) {
        // Split the reply into chunks of max 1800 characters
        const chunks = [];
        let remainingText = reply.trim();
        
        while (remainingText.length > 1800) {
          // Find the last space within 1800 characters to avoid cutting words
          let cutIndex = 1800;
          const lastSpace = remainingText.lastIndexOf(' ', 1800);
          if (lastSpace > 1400) { // Only use space if it's not too far back
        cutIndex = lastSpace;
          }
          
          chunks.push(remainingText.substring(0, cutIndex));
          remainingText = remainingText.substring(cutIndex).trim();
        }
        
        // Add the remaining text as the last chunk
        if (remainingText.length > 0) {
          chunks.push(remainingText);
        }
        
        // Send each chunk - first one as reply, rest as regular messages
        for (let i = 0; i < chunks.length; i++) {
          if (i === 0) {
        await message.reply(chunks[i]);
          } else {
        await message.channel.send(chunks[i]);
          }
          if (i < chunks.length - 1) {
        // Add a small delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      } else {
        await message.reply(reply.trim());
      }
    }
  } catch (error) {
    console.error("Error in message processing:", error);
    console.error("Error details:", {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    // Send error message that will be deleted after 5 seconds
    await sendTemporaryErrorMessage(message, "ขออภัย มีข้อผิดพลาดเกิดขึ้น กรุณาลองใหม่อีกครั้ง");
  }
};

// ==================== EVENT HANDLERS ====================
// Handle incoming messages
client.on("messageCreate", async (message) => {
  // Ignore messages from bots except our target
  if (
    message.author.bot &&
    message.author.username !== botConfig.targetUsername
  )
    return;

  // Check if message is in target channel or from target user
  if (
    message.channel.name !== botConfig.targetChannel &&
    message.author.username !== botConfig.targetUsername
  ) {
    return;
  }

  // Command handlers
  const commands = {
    "!reset": async () => {
      resetChatHistory();
      botConfig.recap = "";
      fs.writeFileSync("botConfig.json", JSON.stringify(botConfig, null, 2));
      await message.reply({
        content: "**Chat history has been reset.**"
      });
    },
    "!gen": async () => {
      await generateImage();

    },
    "!rewind": async () => {
      rewindChatHistory(-1);
      await message.reply({
        content: "**Chat history has been rewind**"
      });
    },
    "!job": async () => {
      await message.reply({
        content: "",
        files: ["./job.jpg"],
      });
    },
    "!status": async () => {
      let botStatus = `Name: ${botConfig.personality[currentPersonality].name}\nDescription: ${botConfig.personality[currentPersonality].description}\nModel: ${botConfig.model[botConfig.currentModel]}`;
      await message.reply({
        content: botStatus,
      });
    },
  };

  // Check for commands
  for (const [command, handler] of Object.entries(commands)) {
    if (
      message.content.startsWith(command) &&
      message.author.username === botConfig.targetUsername
    ) {
      await handler();
      return;
    }
  }

  // Handle regular messages from target user
  await handleUserMessage(message);
});

// ==================== BOT INITIALIZATION ====================
// When bot is ready
client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}!`);
  console.log("🔄 Loading chat history...");
  loadChatHistory();
  console.log("📡 Initializing target channel...");
  initializeTargetChannel();
  console.log("✅ Bot is ready and operational!");
});

// Login to Discord
console.log("🚀 Starting Discord bot...");
client
  .login(process.env.TOKEN)
  .catch((error) => console.error("Error logging in:", error));