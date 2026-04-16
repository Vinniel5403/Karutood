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
// ขยาย database ถ้ายังไม่มี column username หรือ uid
(async () => {
  db = await open({
    filename: "./karutood.sqlite",
    driver: sqlite3.Database,
  });
  await db.run(`CREATE TABLE IF NOT EXISTS collections (
    userId TEXT,
    ShortsUrl TEXT,
    ShortsTitle TEXT,
    username TEXT,
    uid TEXT,
    PRIMARY KEY (userId, ShortsUrl)
  )`);
  // เพิ่ม column username ถ้ายังไม่มี
  try {
    await db.run("ALTER TABLE collections ADD COLUMN username TEXT");
  } catch (e) {}
  // เพิ่ม column uid ถ้ายังไม่มี
  try {
    await db.run("ALTER TABLE collections ADD COLUMN uid TEXT");
  } catch (e) {}
  // เพิ่ม column likes สำหรับ rarity/ระบบขาย
  try {
    await db.run("ALTER TABLE collections ADD COLUMN likes INTEGER DEFAULT 0");
  } catch (e) {}

  // กระเป๋าเงิน
  await db.run(`CREATE TABLE IF NOT EXISTS wallets (
    userId TEXT PRIMARY KEY,
    money INTEGER DEFAULT 0
  )`);
})();

// ราคาขายตาม likes
function priceFromLikes(likes) {
  const n = parseInt(likes || 0);
  return Math.max(1, Math.floor(Math.log10(n + 1) * 20));
}

async function getMoney(userId) {
  if (!db) return 0;
  const row = await db.get("SELECT money FROM wallets WHERE userId = ?", userId);
  return row?.money || 0;
}

async function addMoney(userId, amount) {
  if (!db) return;
  await db.run(
    "INSERT INTO wallets (userId, money) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET money = money + excluded.money",
    userId,
    amount
  );
}

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
const SSHOP_DROP_PRICE = parseInt(process.env.SSHOP_DROP_PRICE || "50", 10);

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

// --- Random drops configuration ---
const DROPS_MIN_SECONDS = parseInt(process.env.DROPS_MIN_SECONDS || "300", 10); // default 5 minutes
const DROPS_MAX_SECONDS = parseInt(process.env.DROPS_MAX_SECONDS || "1800", 10); // default 30 minutes

function randomDelayMs() {
  const min = Math.max(0, DROPS_MIN_SECONDS);
  const max = Math.max(min, DROPS_MAX_SECONDS);
  return Math.floor(Math.random() * (max - min + 1) + min) * 10000;
}

async function sendShortsDropToChannel(channel) {
  try {
    const Shorts = await getRandomMemeShorts();
    if (!Shorts) return;

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

    // Ensure channel can send
    if (!channel || typeof channel.send !== "function") return;

    await channel.send({ content: ShortsText, components: [row] });
    console.log(`📦 Dropped Shorts to #${channel.name} in ${channel.guild?.name || "unknown guild"}`);
  } catch (err) {
    console.error("Error sending drop to channel", channel?.id, err);
  }
}

async function sendDropsOnce() {
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      // find a channel by name
      const channel = guild.channels.cache.find((c) => c.name === targetChannel && typeof c.send === "function");
      if (channel) {
        await sendShortsDropToChannel(channel);
      }
    } catch (e) {
      console.error("Error iterating guilds for drops", guildId, e);
    }
  }
}

function scheduleNextDrop() {
  const delay = randomDelayMs();
  console.log(`⏱️ Next drop in ${Math.round(delay / 1000)}s`);
  setTimeout(async () => {
    await sendDropsOnce();
    scheduleNextDrop();
  }, delay);
}

function startRandomDrops() {
  // only start when client is ready and there is at least one guild
  if (!client.isReady()) return;
  console.log("🎯 Starting random drops");
  // start after a short initial delay to allow caches to populate
  setTimeout(() => scheduleNextDrop(), 5000);
}

client.on(Events.ClientReady, () => {
  // start the drop loop once the bot is ready
  startRandomDrops();
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
      return `พี่ว่าข้อความนี้ไม่ผ่านเซฟตตี้ (Reason: ${error.response.promptFeedback.blockReason}) ลองเปลี่ยนคำพูดนะ`;
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

  // sv <id> — ดู short โดย id (ของใครก็ได้)
  if (/^sv\s+\d+$/i.test(content)) {
    if (!db) return message.reply("พี่ว่า ฐานข้อมูลพัง");
    const id = parseInt(content.split(/\s+/)[1]);
    const row = await db.get(
      "SELECT rowid AS id, userId, username, ShortsTitle, ShortsUrl, likes FROM collections WHERE rowid = ?",
      id
    );
    if (!row) return message.reply(`พี่ว่าไม่มี Short id #${id}`);
    const price = priceFromLikes(row.likes);
    return message.reply(
      `🆔 \`#${row.id}\`\n🎬 [${row.ShortsTitle}](${row.ShortsUrl})\n❤️ Likes: ${row.likes || 0}\n💰 ราคา: ${price}\n👤 เจ้าของ: ${row.username || row.userId}`
    );
  }

  // sell <id> — ขาย short ของตัวเอง
  if (/^sell\s+\d+$/i.test(content)) {
    if (!db) return message.reply("พี่ว่า ฐานข้อมูลพัง");
    const id = parseInt(content.split(/\s+/)[1]);
    const row = await db.get(
      "SELECT rowid AS id, userId, ShortsTitle, likes FROM collections WHERE rowid = ?",
      id
    );
    if (!row) return message.reply(`พี่ว่าไม่มี Short id #${id}`);
    if (row.userId !== message.author.id)
      return message.reply("พี่ว่า Short นี้ไม่ใช่ของน้อง");
    const price = priceFromLikes(row.likes);
    await db.run("DELETE FROM collections WHERE rowid = ?", id);
    await addMoney(message.author.id, price);
    const total = await getMoney(message.author.id);
    return message.reply(`💸 ขาย \`#${id}\` "${row.ShortsTitle}" ได้ ${price} บาท (รวม ${total})`);
  }

  // bal — เช็คเงิน
  if (content.toLowerCase() === "bal") {
    const total = await getMoney(message.author.id);
    return message.reply(`💰 น้องมี ${total} บาท`);
  }

  // sshop / sshop buy drop — ร้านค้า
  if (content.toLowerCase() === "sshop") {
    const total = await getMoney(message.author.id);
    return message.reply(
      `🛒 **SShop**\n\`drop\` — Extra Drop ทันที (${SSHOP_DROP_PRICE} บาท)\n\nเงินน้อง: ${total}\nสั่งซื้อ: \`sshop buy drop\``
    );
  }
  if (/^sshop\s+buy\s+drop$/i.test(content)) {
    const total = await getMoney(message.author.id);
    if (total < SSHOP_DROP_PRICE)
      return message.reply(`พี่ว่าเงินไม่พอ ต้อง ${SSHOP_DROP_PRICE} บาท (น้องมี ${total})`);
    await addMoney(message.author.id, -SSHOP_DROP_PRICE);
    await message.reply(`✅ ซื้อแล้ว! กำลัง drop ให้...`);
    return sendShortsDropToChannel(message.channel);
  }

  // sg @user <id> — ให้ short คนอื่น
  if (/^sg\s/i.test(content) && message.mentions.users.size > 0) {
    if (!db) return message.reply("พี่ว่า ฐานข้อมูลพัง");
    const idMatch = content.match(/\b(\d+)\b/);
    if (!idMatch) return message.reply("ใช้: `sg @user <id>`");
    const id = parseInt(idMatch[1]);
    const recipient = message.mentions.users.first();
    if (recipient.id === message.author.id)
      return message.reply("พี่ว่า ให้ตัวเองทำไม");
    if (recipient.bot) return message.reply("พี่ว่า ให้บอทไม่ได้");

    const row = await db.get(
      "SELECT rowid AS id, userId, ShortsTitle, ShortsUrl FROM collections WHERE rowid = ?",
      id
    );
    if (!row) return message.reply(`พี่ว่าไม่มี Short id #${id}`);
    if (row.userId !== message.author.id)
      return message.reply("พี่ว่า Short นี้ไม่ใช่ของน้อง");

    const dup = await db.get(
      "SELECT 1 FROM collections WHERE userId = ? AND ShortsUrl = ?",
      recipient.id,
      row.ShortsUrl
    );
    if (dup) return message.reply(`พี่ว่า ${recipient.username} มี Short นี้อยู่แล้ว`);

    await db.run(
      "UPDATE collections SET userId = ?, username = ? WHERE rowid = ?",
      recipient.id,
      recipient.username,
      id
    );
    return message.reply(
      `🎁 <@${message.author.id}> ให้ \`#${id}\` "${row.ShortsTitle}" แก่ <@${recipient.id}>`
    );
  }
  if (content === "oputo" && message.author.username === "vinniel_") {
    await generateEmbed(message, "oputo");
  }

  if (content.toLowerCase() === "sd" || ban_list.includes(content)) {
    // อัปเดต username ในฐานข้อมูลเมื่อ user.id ตรง
    if (db) {
      await db.run(
        "UPDATE collections SET username = ? WHERE userId = ?",
        message.author.username,
        message.author.id
      );
    }
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
    // อัปเดต username ในฐานข้อมูลเมื่อ user.id ตรง
    if (db) {
      await db.run(
        "UPDATE collections SET username = ? WHERE userId = ?",
        message.author.username,
        message.author.id
      );
    }
    if (content === "หแ") {
      message.reply({
        content: "รู้มั้ยเราพลาดเรื่องอะไร",
        files: [join(__dirname, "asset", "oputo.gif")],
      });
    }
    if (!db) return message.reply("พี่ว่า ฐานข้อมูลพัง");

    const userId = message.author.id;
    const rows = await db.all(
      "SELECT rowid AS id, ShortsTitle, ShortsUrl, likes FROM collections WHERE userId = ?",
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
            (row) =>
              `\`#${row.id}\` [${row.ShortsTitle}](${row.ShortsUrl}) — ❤️ ${row.likes || 0} • 💰 ${priceFromLikes(row.likes)}`
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
  // เพิ่ม sc @username เพื่อดู collection ของคนอื่น
  if (content.toLowerCase().startsWith("sc ") && message.mentions.users.size > 0) {
    // อัปเดต username ในฐานข้อมูลเมื่อ user.id ตรง
    if (db) {
      await db.run(
        "UPDATE collections SET username = ? WHERE userId = ?",
        message.author.username,
        message.author.id
      );
    }
    if (!db) return message.reply("พี่ว่า ฐานข้อมูลพัง");
    const mentionedUser = message.mentions.users.first();
    const userId = mentionedUser.id;
    const rows = await db.all(
      "SELECT rowid AS id, ShortsTitle, ShortsUrl, likes FROM collections WHERE userId = ?",
      userId
    );
    if (rows.length === 0) {
      await message.reply(`${mentionedUser.username} ยังไม่มี Shorts สะสมเลย`);
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
            (row) =>
              `\`#${row.id}\` [${row.ShortsTitle}](${row.ShortsUrl}) — ❤️ ${row.likes || 0} • 💰 ${priceFromLikes(row.likes)}`
          )
          .join("\n");
        return new EmbedBuilder()
          .setTitle(`Shorts ของ ${mentionedUser.username} (หน้า ${page + 1}/${totalPages})`)
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
    return;
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

  const msgContent = interaction.message.content;
  const ShortsTitle = msgContent.split("\n")[0] || ShortsUrl;

  // ดึง likes จากข้อความ drop
  const likesMatch = msgContent.match(/Likes:\s*(\d+)/i);
  const likes = likesMatch ? parseInt(likesMatch[1]) : 0;

  // ดึง uid จาก ShortsUrl เฉพาะส่วนหลัง /shorts/
  let uid = ShortsUrl;
  const shortsMatch = ShortsUrl.match(/\/shorts\/([\w-]+)/);
  if (shortsMatch) {
    uid = shortsMatch[1];
  }

  // อัปเดต username ให้ทุก collection ของ user นี้ ถ้า username เปลี่ยน
  if (db) {
    await db.run(
      "UPDATE collections SET username = ? WHERE userId = ?",
      interaction.user.username,
      interaction.user.id
    );
  }
  const ins = await db.run(
    "INSERT OR IGNORE INTO collections (userId, ShortsUrl, ShortsTitle, username, uid, likes) VALUES (?, ?, ?, ?, ?, ?)",
    userId,
    ShortsUrl,
    ShortsTitle,
    interaction.user.username,
    uid,
    likes
  );

  // หา id (rowid) ของ collection ที่เพิ่ง insert
  const collected = await db.get(
    "SELECT rowid AS id FROM collections WHERE userId = ? AND ShortsUrl = ?",
    userId,
    ShortsUrl
  );
  const cid = collected?.id;

  await interaction.message
    .edit({
      content: `${msgContent}\n\n<@${userId}> สะสม Shorts นี้แล้ว! 🆔 \`${cid}\` ❌`,
      components: [],
    })
    .catch(() => {});
});

client.login(process.env.DISCORD_BOT_TOKEN);
