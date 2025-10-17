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
import { Readable } from "stream";
import getRandomMemeShorts, { randomQuery } from "./fetch.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  getVoiceConnection,
} from "@discordjs/voice";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import dotenv from "dotenv";
dotenv.config();

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

async function generateEmbed(userMessage, page) {
  const message = userMessage;
  const userId = message.author.id;
  const now = Date.now();
  const lastUsed = sdCooldown.get(userId) || 0;
  if (now - lastUsed < 15 * 60 * 1000) {
    const min = Math.ceil((15 * 60 * 1000 - (now - lastUsed)) / 60000);
    await message.reply(`⏳ คุณต้องรออีก ${min} นาที ถึงจะใช้ sd ได้อีกครั้ง`);
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
    await message.reply("😢 ไม่พบ Shorts ที่ตรงตามเงื่อนไข กำลังสุ่มใหม่");
    generateEmbed(message, page);
  }
}

const sdCooldown = new Map(); // userId -> timestamp
const takeCooldown = new Map(); // userId -> timestamp
const targetChannel = "peace-droper";
// const targetChannel = "darin-test";
const client = new Client({
  // Cooldown map

  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}!`);
});

client.on("messageCreate", async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;
  if (message.channel.name !== targetChannel) return;

  const content = message.content;
  //  if (content ==='test'){
  //   console.log(randomQuery());
  //  }

  if (message.content.toLowerCase() === "testsound") {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply("❌ คุณต้องอยู่ใน Voice Channel ก่อน");
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
    });

    // สร้าง sine wave 1 วินาที (48000 Hz, 16-bit, stereo)
    const sampleRate = 48000;
    const duration = 1; // 1 วินาที
    const freq = 440; // 440Hz = A4
    const samples = sampleRate * duration;
    const buffer = Buffer.alloc(samples * 2 * 2); // 2 channels, 16-bit

    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      const val = Math.floor(Math.sin(2 * Math.PI * freq * t) * 32767); // 16-bit
      buffer.writeInt16LE(val, i * 4); // left
      buffer.writeInt16LE(val, i * 4 + 2); // right
    }

    const stream = Readable.from([buffer]);
    const resource = createAudioResource(stream, { inlineVolume: true });
    resource.volume.setVolume(1.0);

    const player = createAudioPlayer();
    player.play(resource);
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Playing, () =>
      console.log("✅ Sine wave playing...")
    );
    player.on(AudioPlayerStatus.Idle, () => {
      console.log("🛑 Finished, disconnecting...");
      connection.destroy();
    });

    message.reply("🎵 กำลังเล่นเสียง sine wave 1 วินาที!");
  }

  if (content === "oputo" && message.author.username === "vinniel_") {
    await generateEmbed(message, "oputo");
  }
  if (content.toLowerCase() === "sd" || content === "หก") {
    if (content === "หก") {
      // ส่งข้อความพร้อม gif
      await message.reply({
        content: "น้องรู้มั้ยน้องพลาดตรงไหน",
        files: ["./asset/oputo.gif"],
      });

      // ตรวจว่าคนพิมพ์อยู่ใน voice channel ไหม
      const voiceChannel = message.member?.voice?.channel;
      if (!voiceChannel) {
        return;
      }

      // เข้าห้องเสียง
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
      });

      try {
        const player = createAudioPlayer();
        const filePath = path.resolve("./asset/oputo.mp3");
        console.log("🎵 Trying to play:", filePath);

        const resource = createAudioResource(filePath);

        player.play(resource);
        connection.subscribe(player);

        player.on("error", (err) => {
          console.error("❌ Player error:", err);
        });

        player.on(AudioPlayerStatus.Playing, () => {
          console.log("✅ Playing sound now!");
        });

        player.on(AudioPlayerStatus.Idle, () => {
          console.log("🛑 Finished playing, disconnecting...");
          const conn = getVoiceConnection(voiceChannel.guild.id);
          if (conn) conn.destroy();
        });
      } catch (err) {
        console.error("Error playing sound:", err);
      }
    }
    await generateEmbed(message, "");
  }

  // เพิ่มคำสั่ง !collection
  if (content.toLowerCase() === "sc" || content === "หแ") {
    if (content === "หแ") {
      message.reply({
        content: "น้องรู้มั้ยน้องพลาดตรงไหน",
        files: ["./asset/oputo.gif"],
      });
    }
    if (!db) return message.reply("Database ยังไม่พร้อม ลองใหม่อีกครั้ง");
    const userId = message.author.id;
    const rows = await db.all(
      "SELECT ShortsTitle, ShortsUrl FROM collections WHERE userId = ?",
      userId
    );
    if (rows.length === 0) {
      await message.reply("คุณยังไม่มี Shorts ที่สะสมเลย!");
    } else {
      // --- pagination setup ---
      const itemsPerPage = 5; // จำนวนลิงก์ต่อหน้า
      const totalPages = Math.ceil(rows.length / itemsPerPage);
      let page = 0;

      const generateEmbed = (page) => {
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
        embeds: [generateEmbed(page)],
        components: [row],
        ephemeral: true,
      });

      const collector = sentMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120000, // 2 นาที
      });

      collector.on("collect", (i) => {
        if (i.user.id !== message.author.id)
          return i.reply({ content: "คุณไม่สามารถกดได้!", ephemeral: true });

        if (i.customId === "prev") page = page > 0 ? page - 1 : totalPages - 1;
        if (i.customId === "next") page = (page + 1) % totalPages;

        i.update({ embeds: [generateEmbed(page)] });
      });

      collector.on("end", () => {
        sentMessage.edit({ components: [] }); // ปิดปุ่มเมื่อหมดเวลา
      });
    }
  }

  // รับ interaction จากปุ่มสะสม
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.type !== InteractionType.MessageComponent) return;
    if (!interaction.customId.startsWith("collect_")) return;

    const userId = interaction.user.id;
    const now = Date.now();
    const lastTake = takeCooldown.get(userId) || 0;
    if (now - lastTake < 5 * 60 * 1000) {
      // แจ้ง cooldown ในห้อง Karutood

      return;
    }
    takeCooldown.set(userId, now);
    const ShortsUrl = interaction.customId.replace("collect_", "");

    // deferUpdate แค่ครั้งเดียว
    await interaction.deferUpdate().catch(() => {}); // ป้องกัน error ถ้า already acknowledged

    if (!db) return;

    // ตรวจสอบว่ามีแล้วหรือยัง
    const exists = await db.get(
      "SELECT 1 FROM collections WHERE userId = ? AND ShortsUrl = ?",
      userId,
      ShortsUrl
    );

    if (exists) return; // มีแล้วไม่ทำอะไร

    // ดึงชื่อ Shorts จากข้อความเดิม
    const ShortsTitle = interaction.message.content.split("\n")[0] || ShortsUrl;

    // เพิ่มลง DB
    await db.run(
      "INSERT OR IGNORE INTO collections (userId, ShortsUrl, ShortsTitle) VALUES (?, ?, ?)",
      userId,
      ShortsUrl,
      ShortsTitle
    );

    // แก้ไขข้อความเดิม ปิดปุ่ม
    await interaction.message
      .edit({
        content: `${interaction.message.content}\n\n <@${userId}> สะสม Shorts นี้แล้ว!  ❌`,
        components: [],
      })
      .catch(() => {});
  });
});

client.login(process.env.DISCORD_BOT_TOKEN);
