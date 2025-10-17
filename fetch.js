import fetch from "node-fetch";
import { configDotenv } from "dotenv";

configDotenv();

const API_KEY = process.env.API_KEY;
const count = 5;

// รายการ keyword แนว meme / viral / funny
const keywords = [
  "Black People",
  "Instagram",
  "nigga",
  "Fyp",
  "African",
  "Chinese",
  "Cat",
  "Indian",
  "Food",
  "Oputo",
  "meme",
  "ไทย",
];

// ฟังก์ชันสุ่มคำ 0–2 คำ แล้วรวมด้วย OR
export function randomQuery() {
  const num = Math.floor(Math.random() * 3+2); // เลือก0-2คำ
  const shuffled = keywords.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, num);
  return selected.join(" OR ");
}

// แปลง ISO 8601 duration เป็นวินาที
function parseDuration(duration) {
  const match = duration.match(/PT(\d+M)?(\d+S)?/);
  const minutes = parseInt(match?.[1] || 0);
  const seconds = parseInt(match?.[2] || 0);
  return minutes * 60 + seconds;
}

export default async function getRandomMemeShorts(keywords) {
const query = keywords ? keywords : randomQuery();
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?key=${API_KEY}&maxResults=${count}&part=snippet&type=video&videoDuration=short&q=${encodeURIComponent(
    query
  )}`;

  try {
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (!searchData.items) return console.log("❌ ไม่มีข้อมูล");

    const videoIds = searchData.items.map((item) => item.id.videoId).join(",");
    const detailUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${API_KEY}`;
    const detailRes = await fetch(detailUrl);
    const detailData = await detailRes.json();

    const filtered = detailData.items.filter((v) => {
      const likes = parseInt(v.statistics.likeCount || 0);
      const duration = parseDuration(v.contentDetails.duration || "PT0S");
      return duration < 80 && likes >= 10;
    });

    if (filtered.length === 0) return null;

    const randomVid = filtered[Math.floor(Math.random() * filtered.length)];

    // filtered.forEach((v) => {
    //   console.log(`▶️ ${v.snippet.title}`);
    //   console.log(`❤️ Likes: ${v.statistics.likeCount}`);
    //   console.log(`⏱ Duration: ${parseDuration(v.contentDetails.duration)}s`);
    //   console.log(`🔗 https://www.youtube.com/shorts/${v.id}\n`);
    // });
    const result = `🎬 ${randomVid.snippet.title}\n❤️ Likes: ${
      randomVid.statistics.likeCount
    }\n⏱ Duration: ${parseDuration(
      randomVid.contentDetails.duration
    )}s\n🔗 https://www.youtube.com/shorts/${randomVid.id}`;

    console.log(`🔍 คำค้น: ${query}`);
    console.log(result);

    return result;
  } catch (err) {
    console.error("เกิดข้อผิดพลาด:", err);
  }
}
