import Link from "next/link";

const navItems = [
  { href: "/pdfs", label: "PDF管理", desc: "アップロード・カテゴリ管理・LINE送信" },
  { href: "/reminders", label: "リマインダー", desc: "定期テキストの自動LINE送信" },
  { href: "/recipients", label: "送信先管理", desc: "LINEユーザーの登録・編集" },
];

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-bold mb-2 tracking-tight">
        LINE PDF DELIVERY
      </h1>
      <p className="text-zinc-400 text-sm mb-10">
        PDF一括取り込み → LINE個別配信
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <div className="border border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900 rounded-lg p-5 transition-colors">
              <div className="font-semibold text-sm mb-1">{item.label}</div>
              <div className="text-xs text-zinc-500">{item.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
