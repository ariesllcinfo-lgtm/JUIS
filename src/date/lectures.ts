// src/data/lectures.ts
//
// 講義動画のデータです。YouTubeにアップロードしたら、
// 該当する youtubeId（動画URLの v= のあとの部分）を入れてください。
// 空文字のままなら「準備中」と表示されます。
// 新しい講義を増やすときは、この配列に1件追加するだけでOKです。

export interface Lecture {
  faculty: string;
  title: string;
  color: string;
  youtubeId: string;
}

export const lectures: Lecture[] = [
  { faculty: "情報法経学部", title: "情報社会と法制度入門", color: "#1e3a8a", youtubeId: "" },
  { faculty: "社会福祉学部", title: "対人援助の基礎", color: "#b45253", youtubeId: "" },
  { faculty: "知的財産商学部", title: "ブランドと知的財産", color: "#8a6d3b", youtubeId: "" },
  { faculty: "コミュニケーション保障学部", title: "情報保障の基礎", color: "#2f6f6f", youtubeId: "" },
  { faculty: "システム農学部", title: "環境システム概論", color: "#3f6b34", youtubeId: "" },
  { faculty: "College of Design", title: "デザイン思考入門", color: "#6b3f8a", youtubeId: "" },
];
