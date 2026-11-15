import { useLayoutEffect, useRef } from 'react';

/** Only an active, overflowing label owns an animation; no idle timers or observers. */
export function ScrollText({ text, active, className }: { text: string; active: boolean; className: string }) {
  const viewport = useRef<HTMLSpanElement>(null), content = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const box = viewport.current, label = content.current;
    if (!active || !box || !label) return;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let animation: Animation | undefined;
    function stop() { animation?.cancel(); animation = undefined; box!.classList.remove('scrolling'); }
    function play() {
      stop();
      if (preference.matches || document.hidden) { box!.classList.remove('measuring'); return; }
      // Inline text is not reported by ResizeObserver. Keep active text measurable
      // even when it initially fits, so later font/layout changes can start scrolling.
      box!.classList.add('measuring');
      const distance = label!.scrollWidth - box!.clientWidth;
      if (distance <= 1) return;
      box!.classList.add('scrolling');
      const travel = distance / 32 * 1000, pause = 600, duration = travel + pause * 2;
      const end = `translateX(-${distance + 1}px)`;
      animation = label!.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: pause / duration },
        { transform: end, offset: (pause + travel) / duration },
        { transform: end, offset: 1 },
      ], { duration, iterations: Infinity, direction: 'normal', easing: 'linear' });
    }
    const resize = new ResizeObserver(play);
    resize.observe(box); resize.observe(label);
    preference.addEventListener('change', play);
    play();
    return () => { resize.disconnect(); preference.removeEventListener('change', play); stop(); box.classList.remove('measuring'); };
  }, [active, text]);
  return <span ref={viewport} className={'scroll-text ' + className}><span ref={content} className="scroll-content">{text}</span></span>;
}
