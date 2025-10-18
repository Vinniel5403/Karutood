import {
  Client,
  Events,
  GatewayIntentBits,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
  InteractionType,
} from "discord.js";
import getRandomMemeShorts, { randomQuery } from "./fetch.js";
import { GoogleGenAI } from "@google/genai";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  getVoiceConnection,
  generateDependencyReport,
} from "@discordjs/voice";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import dotenv from "dotenv";
import fetch from "node-fetch"; // ใช้ fetch สำหรับเรียก API
dotenv.config();

// สร้าง __dirname สำหรับ ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ตรวจสอบ dependencies ตอนเริ่มต้น
console.log("📦 Voice Dependencies:");
console.log(generateDependencyReport());

const ban_list = ["หก", "kd", "กด","าก"];

// เปิด/สร้าง database
let db;
(async () => {
  db = await open({
    filename: "./karutood.sqlite",
    driver: sqlite3.Database,
  });
  await db.run(`CREATE TABLE IF NOT EXISTS collections (
    userId TEXT,
    ShortsUrl TEXT,
    ShortsTitle TEXT,
    PRIMARY KEY (userId, ShortsUrl)
  )`);
})();

async function voice(sound, gif, text, userMessage) {
  const message = userMessage;
  await message.reply({
    content: text,
    files: [join(__dirname, "asset", `${gif}.gif`)],
  });

  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) {
    return;
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  try {
    const player = createAudioPlayer();
    const audioPath = join(__dirname, "asset", `${sound}.mp3`);

    const resource = createAudioResource(audioPath, {
      inlineVolume: true,
    });
    resource.volume?.setVolume(1.2);

    connection.subscribe(player);
    player.play(resource);

    player.on("error", (error) => {
      connection.destroy();
    });

    player.on(AudioPlayerStatus.Idle, () => {
      setTimeout(() => {
        connection.destroy();
      }, 500);
    });
  } catch (err) {
    connection.destroy();
  }
}
async function generateEmbed(userMessage, page) {
  const message = userMessage;
  const userId = message.author.id;
  const now = Date.now();
  const lastUsed = sdCooldown.get(userId) || 0;
  if (now - lastUsed < 15 * 60 * 1000) {
    const min = Math.ceil((15 * 60 * 1000 - (now - lastUsed)) / 60000);
    await message.reply(`⏳ พี่ว่าน้องต้องรออีก ${min} นาที`);
    return;
  }
  sdCooldown.set(userId, now);
  const Shorts = await getRandomMemeShorts(page);
  if (Shorts) {
    let ShortsText = Shorts;
    let ShortsUrl = Shorts;
    let ShortsTitle = "";
    if (typeof Shorts === "object" && Shorts.url) {
      ShortsText = Shorts.text || Shorts.url;
      ShortsUrl = Shorts.url;
      ShortsTitle = Shorts.title || Shorts.text || Shorts.url;
    } else {
      const urlMatch = Shorts.match(/https?:\/\/\S+/);
      ShortsUrl = urlMatch ? urlMatch[0] : Shorts;
      ShortsTitle = Shorts;
    }
    ShortsText = `${ShortsTitle}`;
    const collectButton = new ButtonBuilder()
      .setCustomId(`collect_${ShortsUrl}`.slice(0, 100))
      .setLabel("Take")
      .setStyle(ButtonStyle.Success);
    const row = new ActionRowBuilder().addComponents(collectButton);
    await message.reply({ content: ShortsText, components: [row] });
  } else {
    await message.reply("พี่ว่า Shorts พัง");
    generateEmbed(message, page);
  }
}

const sdCooldown = new Map();
const takeCooldown = new Map();
const targetChannel = "peace-droper";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.on(Events.ClientReady, (readyClient) => {
  console.log(`✅ Logged in as ${readyClient.user.tag}!`);
});

// 1. [แก้ไข] Import library ของ Google


async function genAI(messageText, author) {
  const ai = new GoogleGenAI({});



try{
    const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `คุณคือพี่ Oputo หรือพี่พุท เป็นผู้ชายอายุ30 คุณคือนักแข่ง Overwatch ที่เก่งมากๆ และเป็นstreamer ที่โคชและสอนเก่งมากๆ ชอบพูดว่า"น้องรู้มั้ยน้องพลาดตรงไหน"เชิงๆ ถามคนดู เพื่อสอนคนดู คุยดีสุภาพ ตอบกลับข้อความต่อไปนี้ในสไตล์ของคุณ:\n\n"${messageText}"\n\nจาก ${author}`,
  });
 

 
    
    return response.text;

  } catch (error) {
    // 6. [แก้ไข] Error handling (SDK จะโยน error มาถ้ามีปัญหา)
    console.error("Error calling Google Generative AI:", error);

    // ตรวจสอบว่าเป็น error จาก safety settings หรือไม่
    // (โครงสร้าง error อาจต่างกันไปขึ้นอยู่กับเวอร์ชัน)
    if (error.response && error.response.promptFeedback && error.response.promptFeedback.blockReason) {
      return `พี่ว่าข้อความนี้ไม่ผ่านเซฟตี้ (Reason: ${error.response.promptFeedback.blockReason}) ลองเปลี่ยนคำพูดนะ`;
    }
    
    // ตรวจสอบกรณีที่ response มี แต่ไม่มี text (อาจจะ finishReason = SAFETY)
    if (error.response && error.response.candidates && error.response.candidates[0].finishReason === 'SAFETY') {
        return "พี่ว่า Gemini บล็อคคำตอบนี้เพราะติดเซฟตี้ ลองใหม่อีกทีนะ";
    }

    return "พี่ว่า API มีปัญหา (SDK catch) ลองใหม่อีกทีนะ";
  }
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.name !== targetChannel) return;

  const content = message.content;


  if (message.mentions.has(client.user)) {
    const replyText = await genAI(content, message.author); // เรียกใช้ genAI
    await message.reply({
      content: replyText,
    });
  }
  if (content === 'job'){
    await message.reply({
      content: "",
      files: [join(__dirname, "asset", "job.jpg")],
    });
  }
  if (content === "oputo" && message.author.username === "vinniel_") {
    await generateEmbed(message, "oputo");
  }

  if (content.toLowerCase() === "sd" || ban_list.includes(content)) {
    if (content === "หก" || content === "กด" ) {
      voice("oputo", "oputo", "รู้มั้ยเราพลาดเรื่องอะไร", message);
    }
    if (content === 'kd' || content === 'าก') {
      voice("kd", "kd", "เหตุการณ์นี้แม่ง 1 ในล้านอะ", message);
      return;
    }
    await generateEmbed(message, "");
  }

  if (content.toLowerCase() === "sc" || content === "หแ") {
    if (content === "หแ") {
      message.reply({
        content: "รู้มั้ยเราพลาดเรื่องอะไร",
        files: [join(__dirname, "asset", "oputo.gif")],
      });
    }
    if (!db) return message.reply("พี่ว่า ฐานข้อมูลพัง");

    const userId = message.author.id;
    const rows = await db.all(
      "SELECT ShortsTitle, ShortsUrl FROM collections WHERE userId = ?",
      userId
    );

    if (rows.length === 0) {
      await message.reply("รู้มั้ยน้องพลาดตรงไหน น้องยังไม่มี Shorts สะสมเลย");
    } else {
      const itemsPerPage = 5;
      const totalPages = Math.ceil(rows.length / itemsPerPage);
      let page = 0;

      const generatePageEmbed = (page) => {
        const start = page * itemsPerPage;
        const end = start + itemsPerPage;
        const list = rows
          .slice(start, end)
          .map(
            (row, i) =>
              `${start + i + 1}. [${row.ShortsTitle}](${row.ShortsUrl})`
          )
          .join("\n");

        return new EmbedBuilder()
          .setTitle(`รายการ Shorts ที่คุณสะสม (หน้า ${page + 1}/${totalPages})`)
          .setDescription(list)
          .setColor(0x00ff00)
          .setFooter({ text: "ขอบคุณที่สะสม Shorts!" });
      };

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("prev")
          .setLabel("⬅ ก่อนหน้า")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("next")
          .setLabel("ถัดไป ➡")
          .setStyle(ButtonStyle.Primary)
      );

      const sentMessage = await message.reply({
        embeds: [generatePageEmbed(page)],
        components: [row],
      });

      const collector = sentMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120000,
      });

      collector.on("collect", (i) => {
        if (i.user.id !== message.author.id) {
          return i.reply({ content: "คุณไม่สามารถกดได้!", ephemeral: true });
        }

        if (i.customId === "prev") page = page > 0 ? page - 1 : totalPages - 1;
        if (i.customId === "next") page = (page + 1) % totalPages;

        i.update({ embeds: [generatePageEmbed(page)] });
      });

      collector.on("end", () => {
        sentMessage.edit({ components: [] });
      });
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.type !== InteractionType.MessageComponent) return;
  if (!interaction.customId.startsWith("collect_")) return;

  const userId = interaction.user.id;
  const now = Date.now();
  const lastTake = takeCooldown.get(userId) || 0;

  if (now - lastTake < 5 * 60 * 1000) {
    return;
  }

  takeCooldown.set(userId, now);
  const ShortsUrl = interaction.customId.replace("collect_", "");

  await interaction.deferUpdate().catch(() => {});

  if (!db) return;

  const exists = await db.get(
    "SELECT 1 FROM collections WHERE userId = ? AND ShortsUrl = ?",
    userId,
    ShortsUrl
  );

  if (exists) return;

  const ShortsTitle = interaction.message.content.split("\n")[0] || ShortsUrl;

  await db.run(
    "INSERT OR IGNORE INTO collections (userId, ShortsUrl, ShortsTitle) VALUES (?, ?, ?)",
    userId,
    ShortsUrl,
    ShortsTitle
  );

  await interaction.message
    .edit({
      content: `${interaction.message.content}\n\n<@${userId}> สะสม Shorts นี้แล้ว! ❌`,
      components: [],
    })
    .catch(() => {});
});

client.login(process.env.DISCORD_BOT_TOKEN);
