import { useState } from "react";

/** First image loads eagerly-lazy; others only mount once the user swipes/taps to them. */
export function Carousel({ images, alt }: { images: string[]; alt: string }) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<Set<number>>(() => new Set([0]));

  if (images.length === 0) {
    return <div className="aspect-[4/5] w-full bg-neutral-800" />;
  }

  const go = (next: number) => {
    const i = (next + images.length) % images.length;
    setLoaded((prev) => new Set(prev).add(i));
    setIndex(i);
  };

  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden bg-neutral-800">
      {images.map((src, i) =>
        loaded.has(i) ? (
          <img
            key={src}
            src={src}
            alt={alt}
            loading="lazy"
            referrerPolicy="no-referrer"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
              i === index ? "opacity-100" : "opacity-0"
            }`}
          />
        ) : null,
      )}
      {images.length > 1 && (
        <>
          <button
            aria-label="Previous image"
            onClick={() => go(index - 1)}
            className="absolute inset-y-0 left-0 w-1/3"
          />
          <button
            aria-label="Next image"
            onClick={() => go(index + 1)}
            className="absolute inset-y-0 right-0 w-1/3"
          />
          <div className="pointer-events-none absolute bottom-1.5 left-0 right-0 flex justify-center gap-1">
            {images.map((src, i) => (
              <span
                key={src}
                className={`h-1 w-1 rounded-full ${i === index ? "bg-white" : "bg-white/40"}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
