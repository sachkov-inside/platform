"use client";

// Storybook serves these tiny SVG sources directly; they need no Next image optimizer.
/* oxlint-disable next/no-img-element */

// Owner selected header A in #311. Compare identity before promoting the header.
import { useState } from "react";
import { NavigationPrototype } from "./navigation.prototype";
import "./brand.prototype.css";

const directions = ["monogram", "frame", "type"] as const;
type Direction = (typeof directions)[number];
const concepts = {
  monogram: {
    name: "A · Монограмма SI",
    short: "SI",
    file: "si-monogram.svg",
    description:
      "Инициалы автора и платформы. Компактный знак, который работает отдельно от названия.",
  },
  frame: {
    name: "B · Внутри рамки",
    short: "Рамка",
    file: "inside-frame.svg",
    description:
      "Открытая рамка и элемент внутри. Знак про контекст, устройство системы и взгляд изнутри.",
  },
  type: {
    name: "C · Только название",
    short: "Название",
    file: "inside-type-icon.svg",
    description:
      "Главный акцент — само имя Sachkov Inside. В шапке без отдельного символа; для вкладки — маленькая i.",
  },
} as const;

function Logo({ direction }: { readonly direction: Direction }) {
  return (
    <span className="si-lockup" data-direction={direction}>
      {direction !== "type" && (
        <img
          className="si-mark"
          src={`/brand-study/${concepts[direction].file}`}
          alt=""
          width="40"
          height="40"
        />
      )}
      <span className="si-name">
        <span>Sachkov</span> <span>Inside</span>
      </span>
    </span>
  );
}

export function BrandPrototype({
  initialDirection = "monogram",
  initialView = "board",
}: {
  readonly initialDirection?: Direction;
  readonly initialView?: "board" | "header";
}) {
  const [direction, setDirection] = useState<Direction>(initialDirection);
  const [view, setView] = useState(initialView);

  return (
    <div data-public-shell data-brand-study>
      {view === "board" ? (
        <main className="si-board">
          <header className="si-intro">
            <p>ЛОГОТИП ПЛАТФОРМЫ</p>
            <h1>Sachkov Inside</h1>
            <p>
              Три направления в текущих цветах. Верхняя шапка уже выбрана —
              сейчас сравниваем знак и написание названия.
            </p>
          </header>
          <div className="si-concepts">
            {directions.map((item) => (
              <section
                key={item}
                className="si-concept"
                aria-label={concepts[item].name}
              >
                <header>
                  <h2>{concepts[item].name}</h2>
                  {item === "monogram" && (
                    <span className="si-recommendation">Мой выбор</span>
                  )}
                </header>
                <div className="si-display">
                  <Logo direction={item} />
                </div>
                <div className="si-inverse">
                  <Logo direction={item} />
                </div>
                <div className="si-small">
                  <span>Иконка сайта</span>
                  {[32, 24, 16].map((size) => (
                    <span key={size}>
                      <img
                        src={`/brand-study/${concepts[item].file}`}
                        width={size}
                        height={size}
                        alt={`${concepts[item].short}, ${String(size)} пикселей`}
                      />
                      <small>{size}</small>
                    </span>
                  ))}
                </div>
                <p className="si-description">{concepts[item].description}</p>
                <div className="si-actions">
                  <button
                    onClick={() => {
                      setDirection(item);
                      setView("header");
                    }}
                  >
                    Посмотреть в шапке <span aria-hidden="true">↗</span>
                  </button>
                  <a href={`/brand-study/${concepts[item].file}`} download>
                    SVG ↓
                  </a>
                </div>
              </section>
            ))}
          </div>
          <p className="si-footnote">
            В шапке всегда полное название Sachkov Inside. На телефоне оно
            занимает две строки. Представленные знаки — варианты для выбора, не
            финальная айдентика.
          </p>
        </main>
      ) : (
        <NavigationPrototype
          initialVariant="header"
          showNavigationControls={false}
          brandContent={<Logo direction={direction} />}
        />
      )}
      <aside className="si-controls" aria-label="Сравнение логотипов">
        <div className="si-control-tabs">
          {directions.map((item) => (
            <button
              key={item}
              aria-label={concepts[item].name}
              aria-pressed={direction === item}
              onClick={() => {
                setDirection(item);
                setView("header");
              }}
            >
              <span className="si-control-full">{concepts[item].name}</span>
              <span className="si-control-short">{concepts[item].short}</span>
            </button>
          ))}
        </div>
        <button
          className="si-view-toggle"
          onClick={() => {
            setView(view === "board" ? "header" : "board");
          }}
        >
          {view === "board" ? "В шапке ↗" : "Все логотипы"}
        </button>
      </aside>
    </div>
  );
}
