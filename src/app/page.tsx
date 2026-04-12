import Link from "next/link";

const navItems = [
  { href: "/pdfs", label: "PDF管理", desc: "アップロード・カテゴリ管理・LINE送信" },
  { href: "/recipients", label: "送信先管理", desc: "LINEユーザーの登録・編集" },
  { href: "#", label: "送信履歴", desc: "配信結果の確認", disabled: true },
  { href: "#", label: "設定", desc: "LINE API・Storage接続設定", disabled: true },
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-xl">
        {navItems.map((item) => {
          const card = (
            <div
              key={item.href + item.label}
              className={`border rounded-lg p-5 transition-colors ${
                item.disabled
                  ? "border-zinc-800 text-zinc-600 cursor-not-allowed"
                  : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900"
              }`}
            >
              <div className="font-semibold text-sm mb-1">
                {item.label}
                {item.disabled && (
                  <span className="ml-2 text-xs text-zinc-600">準備中</span>
                )}
              </div>
              <div className="text-xs text-zinc-500">{item.desc}</div>
            </div>
          );

          if (item.disabled) return <div key={item.label}>{card}</div>;
          return (
            <Link key={item.href} href={item.href}>
              {card}
            </Link>
          );
        })}
      </div>
    </main>
  );
}
