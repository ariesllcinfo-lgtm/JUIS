// src/data/books.ts
//
// 学生割引で購入できる書籍のデータです。
// 新しい書籍を増やすときは、この配列に1件追加するだけでOKです。

export interface Book {
  faculty: string;
  title: string;
  price: number;
  studentPrice: number;
  color: string;
}

export const books: Book[] = [
  { faculty: "情報法経学部", title: "情報社会と法のデザイン", price: 2800, studentPrice: 1400, color: "#1e3a8a" },
  { faculty: "社会福祉学部", title: "対人援助の基礎", price: 2400, studentPrice: 1200, color: "#b45253" },
  { faculty: "知的財産商学部", title: "ブランド価値のつくりかた", price: 3000, studentPrice: 1500, color: "#8a6d3b" },
  { faculty: "コミュニケーション保障学部", title: "伝わる情報保障入門", price: 2600, studentPrice: 1300, color: "#2f6f6f" },
  { faculty: "システム農学部", title: "環境システムと農の未来", price: 2900, studentPrice: 1450, color: "#3f6b34" },
  { faculty: "College of Design", title: "デザイン思考の実践", price: 3200, studentPrice: 1600, color: "#6b3f8a" },
];
