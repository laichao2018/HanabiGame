import type { Knowledge } from "@hanabi/game-engine";
import type { VisibleCard } from "../types";
const symbols={red:"蜻",yellow:"菊",green:"扇",blue:"星",white:"月"};
export function GameCard({card,knowledge,selected,onClick,small=false}:{card:VisibleCard;knowledge?:Knowledge;selected?:boolean;onClick?:()=>void;small?:boolean}){
 const hidden=!card.color; const knownColor=hidden?knowledge?.colors[0]:undefined; const shownRank=card.rank??knowledge?.ranks[0];
 return <button type="button" className={`game-card ${hidden?"hidden":card.color} ${knownColor?`known-color ${knownColor}`:""} ${shownRank&&hidden?"known-rank":""} ${selected?"selected":""} ${small?"small":""}`} onClick={onClick} aria-label={hidden?`自己的手牌${knownColor?`，已知${knownColor}`:""}${shownRank?`，已知数字${shownRank}`:""}`:`${card.color} ${card.rank}`}><span className="card-pattern"/><span className="card-symbol">{hidden?(knownColor?symbols[knownColor]:"花"):symbols[card.color!]}</span>{shownRank&&<b>{shownRank}</b>}</button>
}
