import fetch from "node-fetch";
import { configDotenv } from "dotenv";

configDotenv();

const API_KEY = process.env.API_KEY;
const count = 15;

// รายการ keyword แนว meme / viral / funny
const keywords = [
  "Black People",
  "Instagram",
  "Chinese",
  "Cat",
  "Food",
  "Oputo",
  "meme",
  "ไทย",
  "chefhiro4898",
  "CrunchycatLuna",
  "BayashiTV_",
  "PeeBaoKitchen",
  "Bosscat4444",
  "uma musume",
  "JIMSURIYAV2",
  "มาลี สวยมาก",
  "Overboot",
  "อีสาน",
  "My Mate Nate",
  "Ishowspeed",
  "Opztv",
  "Artist",
  "Mistake When Drawing",
  "TheMainManSWE",
  "พี่เสก",
  "Revy Ghosting",
  "Sushi Monsters",
  "ไวรัล",
  "shorts",
  "vtuber",
  "undertale",
  "mukbang",
  "Ado",
  "Tiktok",
  "Laibaht",
  "Fumihouse",
  "นานาโฮชิ นานะ / 七星ナナ",
  "Edit",
  "Anime Edit"
];

// ฟังก์ชันสุ่มคำ 2–5 คำ แล้วรวมด้วย OR
export function randomQuery() {
  const num = Math.floor(Math.random() * 0 + 4);
  const selected = [];
  const usedIndexes = new Set();

  while (selected.length < num) {
    const idx = Math.floor(Math.random() * keywords.length);
    if (!usedIndexes.has(idx)) {
      usedIndexes.add(idx);
      selected.push(keywords[idx]);
    }
  }

  return selected.join(" OR ");
}

// แปลง ISO 8601 duration เป็นวินาที
function parseDuration(duration) {
  const match = duration.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
  const minutes = parseInt(match?.[1] || 0);
  const seconds = parseInt(match?.[2] || 0);
  return minutes * 60 + seconds;
}

// cache pool — fetch ทีเก็บไว้, pop จนหมด แล้วค่อย fetch ใหม่
const poolCache = new Map(); // key → { items: [], query }

function formatVideo(v) {
  return `🎬 ${v.snippet.title}
❤️ Likes: ${v.statistics.likeCount}
⏱ Duration: ${parseDuration(v.contentDetails.duration)}s
🔗 https://www.youtube.com/shorts/${v.id}`;
}

async function fetchPool(query) {
  const randomPage = Math.floor(Math.random() * 0);
  let pageToken = "";
  let searchData = null;

  for (let i = 0; i <= randomPage; i++) {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?key=${API_KEY}&maxResults=${count}&part=snippet&type=video&videoDuration=short&q=${encodeURIComponent(
      query
    )}${pageToken ? `&pageToken=${pageToken}` : ""}`;

    const res = await fetch(searchUrl);
    searchData = await res.json();

    if (!searchData.items || searchData.items.length === 0) break;
    pageToken = searchData.nextPageToken || "";
    if (!pageToken) break;
  }

  if (!searchData?.items?.length) return [];

  const videoIds = searchData.items.map((item) => item.id.videoId).join(",");
  const detailUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${API_KEY}`;
  const detailRes = await fetch(detailUrl);
  const detailData = await detailRes.json();

  return (detailData.items || []).filter((v) => {
    const likes = parseInt(v.statistics.likeCount || 0);
    const duration = parseDuration(v.contentDetails.duration || "PT0S");
    return duration < 80 && likes >= 10;
  });
}

export default async function getRandomMemeShorts(inputKeyword) {
  try {
    const cacheKey = inputKeyword || "__random__";
    let entry = poolCache.get(cacheKey);

    // refill ถ้า empty หรือไม่เคย fetch
    if (!entry || entry.items.length === 0) {
      const query = inputKeyword || randomQuery();
      const items = await fetchPool(query);
      if (items.length === 0) {
        poolCache.delete(cacheKey);
        console.log("❌ ไม่มีข้อมูลในคำค้นนี้");
        return null;
      }
      // shuffle
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      entry = { items, query };
      poolCache.set(cacheKey, entry);
      console.log(`🔄 fetch ใหม่: ${query} (${items.length} clips)`);
    }

    // pop 1
    const vid = entry.items.pop();
    if (entry.items.length === 0) poolCache.delete(cacheKey);

    const result = formatVideo(vid);
    console.log(`🔍 คำค้น: ${entry.query} (เหลือ ${entry.items.length})`);
    console.log(result);
    return result;
  } catch (err) {
    console.error("เกิดข้อผิดพลาด:", err);
    return null;
  }
}
