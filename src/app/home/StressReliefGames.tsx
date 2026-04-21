"use client";

import { useEffect, useMemo, useState } from "react";

type BreathPhase = "吸氣" | "停住" | "呼氣";
type RpsMove = "Rock" | "Scissor" | "Stone";

export default function StressReliefGames() {
  const [phase, setPhase] = useState<BreathPhase>("吸氣");
  const [running, setRunning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(4);

  const [clickTimeLeft, setClickTimeLeft] = useState(15);
  const [clickRunning, setClickRunning] = useState(false);
  const [clickScore, setClickScore] = useState(0);

  const [guess, setGuess] = useState<number | null>(null);
  const [target, setTarget] = useState(() => Math.floor(Math.random() * 10) + 1);
  const [guessResult, setGuessResult] = useState("");
  const [rpsMyMove, setRpsMyMove] = useState<RpsMove | null>(null);
  const [rpsCpuMove, setRpsCpuMove] = useState<RpsMove | null>(null);
  const [rpsResult, setRpsResult] = useState("");
  const [rpsScore, setRpsScore] = useState({ win: 0, draw: 0, lose: 0 });

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev > 1) return prev - 1;
        if (phase === "吸氣") {
          setPhase("停住");
          return 2;
        }
        if (phase === "停住") {
          setPhase("呼氣");
          return 6;
        }
        setPhase("吸氣");
        return 4;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, running]);

  useEffect(() => {
    if (!clickRunning) return;
    if (clickTimeLeft <= 0) {
      setClickRunning(false);
      return;
    }
    const timer = window.setTimeout(() => setClickTimeLeft((v) => v - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [clickRunning, clickTimeLeft]);

  const phaseHint = useMemo(() => {
    if (phase === "吸氣") return "慢慢吸氣，放鬆肩膀";
    if (phase === "停住") return "輕輕停住，保持平靜";
    return "慢慢呼氣，放鬆身體";
  }, [phase]);

  function playRps(myMove: RpsMove) {
    const options: RpsMove[] = ["Rock", "Scissor", "Stone"];
    const cpuMove = options[Math.floor(Math.random() * options.length)];
    setRpsMyMove(myMove);
    setRpsCpuMove(cpuMove);

    if (myMove === cpuMove) {
      setRpsResult("和局");
      setRpsScore((s) => ({ ...s, draw: s.draw + 1 }));
      return;
    }

    const win =
      (myMove === "Rock" && cpuMove === "Scissor") ||
      (myMove === "Scissor" && cpuMove === "Stone") ||
      (myMove === "Stone" && cpuMove === "Rock");

    if (win) {
      setRpsResult("你贏咗");
      setRpsScore((s) => ({ ...s, win: s.win + 1 }));
    } else {
      setRpsResult("電腦贏咗");
      setRpsScore((s) => ({ ...s, lose: s.lose + 1 }));
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-bold text-slate-900">減壓小遊戲</h2>
      <p className="mt-1 text-sm text-slate-600">直接喺度玩，抖一抖再做野。</p>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-4">
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">1) 呼吸節奏</p>
          <p className="mt-2 text-2xl font-bold text-[#1d76c2]">{phase}</p>
          <p className="text-sm text-slate-600">{secondsLeft}s</p>
          <p className="mt-2 text-sm text-slate-700">{phaseHint}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setRunning((v) => !v)}
              className="rounded-md bg-[#1d76c2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1663a3]"
            >
              {running ? "暫停" : "開始"}
            </button>
            <button
              type="button"
              onClick={() => {
                setRunning(false);
                setPhase("吸氣");
                setSecondsLeft(4);
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              重設
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">2) 15 秒快手點擊</p>
          <p className="mt-2 text-sm text-slate-700">時間：{clickTimeLeft}s</p>
          <p className="text-sm text-slate-700">分數：{clickScore}</p>
          <button
            type="button"
            disabled={!clickRunning}
            onClick={() => setClickScore((v) => v + 1)}
            className="mt-3 w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            快啲點我
          </button>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setClickScore(0);
                setClickTimeLeft(15);
                setClickRunning(true);
              }}
              className="rounded-md bg-[#1d76c2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1663a3]"
            >
              開始
            </button>
            <button
              type="button"
              onClick={() => {
                setClickRunning(false);
                setClickScore(0);
                setClickTimeLeft(15);
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              清零
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">3) 猜數字 1-10</p>
          <p className="mt-2 text-sm text-slate-700">試下估中電腦揀嘅數字</p>
          <input
            type="number"
            min={1}
            max={10}
            value={guess ?? ""}
            onChange={(e) => setGuess(Number(e.target.value))}
            className="mt-3 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#1d76c2]"
            placeholder="輸入 1-10"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (!guess || guess < 1 || guess > 10) {
                  setGuessResult("請輸入 1 至 10");
                  return;
                }
                if (guess === target) {
                  setGuessResult("中咗！好運氣！");
                } else {
                  setGuessResult(guess < target ? "細咗，再試" : "大咗，再試");
                }
              }}
              className="rounded-md bg-[#1d76c2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1663a3]"
            >
              提交
            </button>
            <button
              type="button"
              onClick={() => {
                setTarget(Math.floor(Math.random() * 10) + 1);
                setGuess(null);
                setGuessResult("");
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              新一局
            </button>
          </div>
          <p className="mt-2 text-sm text-slate-700">{guessResult}</p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">4) Rock Scissor Stone</p>
          <p className="mt-2 text-sm text-slate-700">你出拳，電腦會隨機出拳</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => playRps("Rock")}
              className="rounded-md bg-[#1d76c2] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1663a3]"
            >
              Rock
            </button>
            <button
              type="button"
              onClick={() => playRps("Scissor")}
              className="rounded-md bg-[#1d76c2] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1663a3]"
            >
              Scissor
            </button>
            <button
              type="button"
              onClick={() => playRps("Stone")}
              className="rounded-md bg-[#1d76c2] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1663a3]"
            >
              Stone
            </button>
          </div>
          <p className="mt-3 text-sm text-slate-700">
            你：{rpsMyMove ?? "-"} ｜ 電腦：{rpsCpuMove ?? "-"}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-800">
            結果：{rpsResult || "-"}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            戰績 勝 {rpsScore.win} / 和 {rpsScore.draw} / 負 {rpsScore.lose}
          </p>
          <button
            type="button"
            onClick={() => {
              setRpsMyMove(null);
              setRpsCpuMove(null);
              setRpsResult("");
              setRpsScore({ win: 0, draw: 0, lose: 0 });
            }}
            className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            清除戰績
          </button>
        </section>
      </div>
    </div>
  );
}

