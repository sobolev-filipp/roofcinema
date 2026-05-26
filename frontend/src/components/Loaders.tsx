/**
 * Универсальные индикаторы загрузки:
 * - <Spinner />          — мини-кружок для встраивания в кнопки и инлайн-места
 * - <ProjectorLoader />  — крупный кино-проектор-оверлей (блокирующий)
 * - <Skeleton />         — серый плейсхолдер для данных при загрузке списков
 */

export function Spinner({ large = false }: { large?: boolean }) {
  return <span className={"spinner" + (large ? " spinner-lg" : "")} aria-hidden="true" />;
}

/**
 * Полноэкранный лоадер с анимированным кино-проектором.
 * Использовать для блокирующих операций, которые делают всю страницу неинтерактивной.
 *
 *   {busy && <ProjectorLoader text="Сохраняем фильм" />}
 */
export function ProjectorLoader({ text = "Загружаем" }: { text?: string }) {
  return (
    <div className="projector-overlay" role="status" aria-live="polite">
      <div className="projector">
        <div className="projector-body">
          <div className="projector-reel projector-reel-left" />
          <div className="projector-reel projector-reel-right" />
          <div className="projector-lens" />
        </div>
        <div className="projector-beam" />
        <div className="projector-screen" />
      </div>
      <div className="projector-caption">{text}</div>
    </div>
  );
}

type SkeletonVariant = "text" | "title" | "card" | "row" | "thumb";

/**
 * Скелетон-плейсхолдер. Использовать как замену реального элемента, пока данные грузятся.
 *
 *   {loading ? <Skeleton variant="card" count={3} /> : <RealList />}
 */
export function Skeleton({
  variant = "text",
  count = 1,
  width,
  height,
  style,
}: {
  variant?: SkeletonVariant;
  count?: number;
  width?: string | number;
  height?: string | number;
  style?: React.CSSProperties;
}) {
  const className = "skeleton skeleton-" + variant;
  const items = Array.from({ length: count }, (_, i) => (
    <div
      key={i}
      className={className}
      style={{ width, height, ...style }}
      aria-hidden="true"
    />
  ));
  return <>{items}</>;
}
