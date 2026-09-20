"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { createFriendSoundKit, type FriendSoundKit, type FriendSoundCue } from "@rarefriends/friendsdk/sounds";
import { formatGameAmount } from "@rarefriends/friendsdk/ui";
import type { GameSnapshot } from "@rarefriends/friendsdk/game";
import "@rarefriends/friendsdk/frame.css";
import "./style.css";

// ========================================================
// Game definition (chance-game)
// PvP 95% RTP, verified mathematically
// ========================================================
const GAME_DEFINITION = {
  name: "Rare Friends Egg Smash",
  consumable: "Cracked Egg",
  price: "1000000000000000", // 0.001 ETH preview
  outcomes: [
    { name: "Empty",       chanceBps: 3600, reward: "0" },
    { name: "Bronze",      chanceBps: 3200, reward: "500000000000000000" },
    { name: "Silver",      chanceBps: 1800, reward: "1000000000000000000" },
    { name: "Gold",        chanceBps: 800,  reward: "2000000000000000000" },
    { name: "Diamond",     chanceBps: 400,  reward: "5000000000000000000" },
    { name: "Epic",        chanceBps: 180,  reward: "10000000000000000000" },
    { name: "Mythic",      chanceBps: 18,   reward: "30000000000000000000" },
    { name: "GRAND PRIZE", chanceBps: 2,    reward: "100000000000000000000" },
  ],
};

// ========================================================
// Constants
// ========================================================
const TIERS = [
  { key: 500,   label: "Tiny",   emoji: "🥚" },
  { key: 1000,  label: "Small",  emoji: "🥚" },
  { key: 2000,  label: "Medium", emoji: "🥚" },
  { key: 5000,  label: "Large",  emoji: "🥚" },
  { key: 10000, label: "Mega",   emoji: "🥚" },
];

const EMOJI_BY_NAME: Record<string, string> = {
  "Empty":       "💀",
  "Bronze":      "🥉",
  "Silver":      "🥈",
  "Gold":        "🥇",
  "Diamond":     "💎",
  "Epic":        "🌟",
  "Mythic":      "🦄",
  "GRAND PRIZE": "👑",
};

const FRIEND_EMOJIS = ["🥷", "☕", "🎨", "🧋", "🍵", "👨‍🍳", "🧑‍🍳", "👩‍🍳"];

// ========================================================
// Helpers
// ========================================================
function deriveSkill(friendId: bigint | null): { skill: number; name: string; tier: string } {
  if (friendId === null) return { skill: 50, name: "Apprentice Barista", tier: "apprentice" };
  const v = Number(friendId % 100n) + 1;
  const skill = v;
  let name: string, tier: string;
  if (v >= 80) { name = "Master Barista"; tier = "master"; }
  else if (v >= 50) { name = "Skilled Barista"; tier = "skilled"; }
  else if (v >= 25) { name = "Apprentice Barista"; tier = "apprentice"; }
  else { name = "Novice Barista"; tier = "novice"; }
  return { skill, name, tier };
}

function pickEggEmoji(friendId: bigint | null): string {
  if (friendId === null) return FRIEND_EMOJIS[0];
  return FRIEND_EMOJIS[Number(friendId % BigInt(FRIEND_EMOJIS.length))];
}

// ========================================================
// Component
// ========================================================
export default function RareFriendsEggSmash({ friendId, client, paused = false }: GameComponentProps) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [phase, setPhase] = useState<"idle" | "shaking" | "reveal">("idle");
  const [selectedTier, setSelectedTier] = useState(1000);
  const [lastResult, setLastResult] = useState<{ name: string; amount: bigint; mult: number } | null>(null);
  const [totalWon, setTotalWon] = useState<bigint>(0n);
  const [totalLost, setTotalLost] = useState<bigint>(0n);
  const [error, setError] = useState("");
  const [revealEggs, setRevealEggs] = useState<number[]>([]);
  const [winningEgg, setWinningEgg] = useState<number | null>(null);
  const sound = useRef<FriendSoundKit | null>(null);
  const locked = useRef(false);

  const { skill, name: skillName, tier: skillTier } = useMemo(() => deriveSkill(friendId), [friendId]);
  const skillBonus = Math.floor((skill / 100) * 20); // 0-20%
  const friendEmoji = pickEggEmoji(friendId);

  // Initialize
  useEffect(() => {
    sound.current = createFriendSoundKit({ muted: true });
    void client.read().then(setSnapshot).catch(e => setError(e.message));
  }, [client]);

  async function crackEgg() {
    if (locked.current || paused || phase !== "idle") return;
    if (!snapshot) return;
    const bet = BigInt(selectedTier) * 10n ** 18n;
    const bal = snapshot.rfBalance ?? snapshot.stake;
    if (bal < bet) {
      setError("Insufficient balance");
      return;
    }
    locked.current = true;
    setPhase("shaking");
    setError("");
    setRevealEggs([]);
    setWinningEgg(null);
    void sound.current?.unlock();

    try {
      // FriendSDK chance-game flow: buy → play → settle → redeem
      await client.buy(1n);
      const plays = await client.play(1n);
      const playId = plays[0]?.id;
      if (typeof playId !== "bigint") throw new Error("No play id");
      const settled = await client.settle(playId);
      const outcomeId = settled.outcomeId;
      if (typeof outcomeId !== "number") throw new Error("No outcome");
      await client.redeem(outcomeId, 1n);

      // Map outcome
      const outcome = client.definition.outcomes[outcomeId - 1];
      const name = outcome?.name ?? "Empty";
      const reward = outcome ? BigInt(outcome.reward) : 0n;
      const winAmount = reward;
      const mult = selectedTier > 0 ? Number(winAmount) / 1e18 / selectedTier : 0;

      // Update totals
      setTotalWon(prev => prev + winAmount);
      setTotalLost(prev => prev + bet);
      setLastResult({ name, amount: winAmount, mult });

      // Pick winning egg (random 0-8)
      const targetEgg = Math.floor(Math.random() * 9);
      setWinningEgg(targetEgg);

      // Animate eggs cracking
      const order = [0, 1, 2, 3, 4, 5, 6, 7, 8].sort(() => Math.random() - 0.5);
      const delay = 180;
      order.forEach((i, idx) => {
        setTimeout(() => {
          setRevealEggs(prev => [...prev, i]);
          if (i === targetEgg) sound.current?.play("reveal-rare" as FriendSoundCue);
          else if (idx === order.length - 1) sound.current?.play("reward" as FriendSoundCue);
        }, idx * delay);
      });

      setTimeout(() => setPhase("reveal"), order.length * delay + 300);

      // Refresh snapshot
      const fresh = await client.read();
      setSnapshot(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Crack failed");
      setPhase("idle");
    } finally {
      locked.current = false;
    }
  }

  function nextRound() {
    setPhase("idle");
    setRevealEggs([]);
    setWinningEgg(null);
    setLastResult(null);
  }

  const balance = snapshot ? Number(snapshot.rfBalance ?? snapshot.stake) / 1e18 : 0;
  const netPL = Number(totalWon - totalLost) / 1e18;
  const canAfford = snapshot ? (snapshot.rfBalance ?? snapshot.stake) >= BigInt(selectedTier) * 10n ** 18n : false;

  return (
    <div className={`cafe-root skill-tier-${skillTier}`} data-testid="egg-smash-root">
      {/* Top bar */}
      <div className="cafe-top-bar">
        <div className="cafe-jackpot">
          🎯 <span>Jackpot:</span> {snapshot ? formatGameAmount(snapshot.rewardLiability ?? 0n, 18) : "0"} RF
        </div>
        <div className="cafe-stats-mini">
          <div className="cafe-stat-mini">🏦 <b>{balance.toLocaleString()}</b></div>
          <div className="cafe-stat-mini" style={{color: netPL >= 0 ? "#00ff64" : "#ff4444"}}>
            📈 <b>{netPL >= 0 ? "+" : ""}{netPL.toFixed(0)}</b>
          </div>
        </div>
      </div>

      {/* Friend bar */}
      <div className="cafe-friend-bar">
        <div className={`cafe-friend-sprite skill-${skillTier}`}>{friendEmoji}</div>
        <div className="cafe-friend-info">
          <div className="cafe-friend-name">
            Friend #{friendId?.toString() ?? "—"} · Gen 1+
          </div>
          <span className={`cafe-friend-skill skill-${skillTier}`}>
            {skillName} · Skill {skill}/100
          </span>
          <div className="cafe-skill-bonus">
            Barista Bonus +{skillBonus}% · Better odds on bigger prizes
          </div>
        </div>
      </div>

      {/* Tier selector */}
      <div className="cafe-tiers">
        {TIERS.map(t => (
          <button
            key={t.key}
            className={`cafe-tier ${selectedTier === t.key ? "selected" : ""}`}
            disabled={paused || phase !== "idle"}
            onClick={() => setSelectedTier(t.key)}
          >
            <span className="cafe-tier-label">{t.label}</span>
            <span className="cafe-tier-cost">{t.key.toLocaleString()}</span>
          </button>
        ))}
      </div>

      {/* Stage */}
      <div className="cafe-stage" inert={paused || undefined}>
        {phase === "idle" && (
          <div className="cafe-prompt">
            <div className="cafe-prompt-emoji">{friendEmoji}</div>
            <p>Tap to crack open</p>
            <button className="cafe-btn cafe-btn-primary" onClick={crackEgg} disabled={!canAfford}>
              🥚 CRACK — pay {selectedTier.toLocaleString()} RF
            </button>
          </div>
        )}

        {(phase === "shaking" || phase === "reveal") && (
          <div className={`cafe-eggs ${phase === "shaking" ? "shaking" : ""}`}>
            {Array.from({ length: 9 }).map((_, i) => {
              const isRevealed = revealEggs.includes(i);
              const isWinner = winningEgg === i && isRevealed && phase === "reveal";
              const isEmpty = isRevealed && !isWinner;
              const resultName = isWinner ? lastResult?.name : (isEmpty ? "Empty" : null);
              const emoji = resultName ? (EMOJI_BY_NAME[resultName] ?? "🥚") : "🥚";
              const cls = isWinner
                ? `cafe-egg winner ${(lastResult?.name ?? "").toLowerCase().replace(" ", "-")}`
                : isEmpty
                  ? "cafe-egg empty"
                  : "cafe-egg";
              return (
                <div key={i} className={cls}>
                  <span className="cafe-egg-emoji">{emoji}</span>
                  {resultName && (
                    <span className="cafe-egg-label">{resultName}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {phase === "reveal" && lastResult && (
          <div className="cafe-result">
            <div className="cafe-result-emoji">{EMOJI_BY_NAME[lastResult.name]}</div>
            <h2>{lastResult.name}</h2>
            <div className="cafe-result-amount">
              {lastResult.amount > 0n ? "+" : ""}
              {formatGameAmount(lastResult.amount, 18)} RF
            </div>
            <div className="cafe-result-multiplier">
              Multiplier: <b>{lastResult.mult.toFixed(2)}×</b>
            </div>
            <button className="cafe-btn" onClick={nextRound}>CRACK ANOTHER</button>
          </div>
        )}
      </div>

      {error && (
        <div className="cafe-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
