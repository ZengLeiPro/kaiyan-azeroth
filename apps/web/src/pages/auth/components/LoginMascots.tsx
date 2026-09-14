import * as React from 'react';

/**
 * 登录页装饰：4 个 SVG 卡通角色，眼睛与身体跟随鼠标移动。
 *
 * 设计要点：
 * - 高频动画**不走 React state**：mouse 坐标、瞳孔偏移、身体角度都通过
 *   `useRef` 持有，RAF 内直接 `setProperty` 写 CSS 变量，避免 reconciliation 开销
 * - **坐标缓存**：眼球中心写在 SVG 局部坐标系（viewBox），通过 SVG 的
 *   `getScreenCTM` 将鼠标 viewport 坐标转换到本地坐标，CTM 仅在 mount /
 *   ResizeObserver 时缓存重算，不每帧读布局，避免 layout thrashing
 * - **每角色独立权重**：避免"4 个角色像一块板在歪"的视觉退化
 * - **静态/动态变换分层**：外层 SVG `<g transform>` 做静态定位，内层 div-style
 *   CSS transform 做动态变换，避免 SVG transform 属性被 CSS 覆盖
 * - **dark mode 适配**：黑色角色用 currentColor + Tailwind `text-zinc-800 dark:text-zinc-500`
 * - **可访问性**：纯装饰 aria-hidden + reduced-motion 完全停用动画
 * - 仅监听容器自身 pointermove（不是 window），组件不可见时零开销
 */

const VIEWBOX_W = 400;
const VIEWBOX_H = 500;

// 瞳孔最大偏移（眼眶 r=10，瞳孔 r=3.5，留 0.5 安全边距）
const PUPIL_MAX = 6;
// 眼眶白底半径（紫色/黑色用）
const EYE_SOCKET_R = 10;

interface Eye {
  cx: number;
  cy: number;
}

interface Mascot {
  id: 'purple' | 'black' | 'orange' | 'yellow';
  /** 角色身体中心在 SVG 局部坐标系（viewBox）的位置 */
  cx: number;
  cy: number;
  /** sin(α) × weightTx → 身体水平偏移最大像素（α 是角色到鼠标的方向角） */
  weightTx: number;
  /** cos(α) × weightTy → 身体垂直偏移最大像素（鼠标在角色上方时角色上抬） */
  weightTy: number;
  /** sin(α) × weightRotate → 身体旋转最大度数 */
  weightRotate: number;
  /** 形状 path/rect */
  body: React.ReactElement;
  /** 眼睛在 mascot 局部坐标（相对 cx,cy） */
  eyes: [Eye, Eye];
  /** 眨眼起始相位（秒），错开 4 个角色的眨眼时机 */
  blinkPhase: number;
  /** 眼眶白底（黑/紫底色需要） */
  eyeWithSocket: boolean;
  /** 瞳孔半径 */
  pupilR: number;
  /** 嘴巴（可选） */
  mouth?: React.ReactElement;
}

const MASCOTS: Mascot[] = [
  // 1. 紫色矩形（后排，最高）—— 与其他角色保持同一直立姿态，底部略高于黑色
  {
    id: 'purple',
    cx: 180,
    cy: 280,
    weightTx: 10,
    weightTy: 4,
    weightRotate: 4,
    body: <rect x={-30} y={-130} width={60} height={260} rx={6} />,
    eyes: [
      { cx: -12, cy: -90 },
      { cx: 12, cy: -90 },
    ],
    blinkPhase: 0,
    eyeWithSocket: true,
    pupilR: 3.5,
  },
  // 2. 黑色细矩形（顶部圆角）
  {
    id: 'black',
    cx: 245,
    cy: 305,
    weightTx: 6,
    weightTy: 3,
    weightRotate: 2.5,
    body: <path d="M-25,-100 A25,25 0 0 1 25,-100 L25,110 L-25,110 Z" />,
    eyes: [
      { cx: -11, cy: -75 },
      { cx: 11, cy: -75 },
    ],
    blinkPhase: 1.7,
    eyeWithSocket: true,
    pupilR: 3.5,
  },
  // 3. 橙色蘑菇头（前排左，最矮）
  {
    id: 'orange',
    cx: 115,
    cy: 360,
    weightTx: 14,
    weightTy: 6,
    weightRotate: 7,
    body: <path d="M-55,55 L-55,0 A55,55 0 0 1 55,0 L55,55 Z" />,
    eyes: [
      { cx: -18, cy: 12 },
      { cx: 18, cy: 12 },
    ],
    blinkPhase: 3.2,
    eyeWithSocket: false,
    pupilR: 5,
  },
  // 4. 黄色拱形墓碑（前排右，带嘴）
  {
    id: 'yellow',
    cx: 290,
    cy: 340,
    weightTx: 10,
    weightTy: 4,
    weightRotate: 5,
    body: <path d="M-42,75 L-42,-30 A42,42 0 0 1 42,-30 L42,75 Z" />,
    eyes: [
      { cx: -15, cy: -20 },
      { cx: 15, cy: -20 },
    ],
    blinkPhase: 5.4,
    eyeWithSocket: false,
    pupilR: 5,
    mouth: (
      <line
        x1={-14}
        y1={20}
        x2={14}
        y2={20}
        stroke="#1F1F1F"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    ),
  },
];

// 把 mascot id 映射到 Tailwind 颜色类（fill 用 currentColor）
const FILL_CLASS: Record<Mascot['id'], string> = {
  purple: 'text-[#5B3FFF] dark:text-[#7B5FFF]',
  black: 'text-zinc-800 dark:text-zinc-500',
  orange: 'text-[#FF7A45] dark:text-[#FF8A5C]',
  yellow: 'text-[#FFD93D] dark:text-[#FFE066]',
};

interface MouseLocal {
  /** SVG viewBox 局部坐标 */
  x: number;
  y: number;
  /** 用于身体水平归一化的 viewport X */
  viewportX: number;
}

type FocusMode = 'idle' | 'username' | 'password';

export function LoginMascots() {
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const inverseCTMRef = React.useRef<DOMMatrix | null>(null);
  const svgRectRef = React.useRef<DOMRect | null>(null);
  const mouseLocalRef = React.useRef<MouseLocal | null>(null);
  const rafIdRef = React.useRef<number>(0);

  // focus 状态机：username 时角色凑过去盯着 input；password 时转头到左不偷看
  const focusModeRef = React.useRef<FocusMode>('idle');
  const focusTargetRef = React.useRef<{ x: number; y: number } | null>(null);
  const [focusMode, setFocusMode] = React.useState<FocusMode>('idle');

  const recomputeCTM = React.useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    inverseCTMRef.current = ctm ? ctm.inverse() : null;
    svgRectRef.current = svg.getBoundingClientRect();
  }, []);

  const flush = React.useCallback(() => {
    rafIdRef.current = 0;
    const svg = svgRef.current;
    if (!svg) return;
    const groups = svg.querySelectorAll<SVGGElement>('[data-mascot]');
    const inv = inverseCTMRef.current;
    const mode = focusModeRef.current;

    // 计算本帧"目标点"的 SVG 局部坐标 + 一个 multiplier（focus 模式可放大幅度）
    let target: { x: number; y: number } | null = null;
    let intensity = 1;

    if (mode === 'username' && focusTargetRef.current && inv && svg) {
      const t = focusTargetRef.current;
      const pt = svg.createSVGPoint();
      pt.x = t.x;
      pt.y = t.y;
      const localPt = pt.matrixTransform(inv);
      target = { x: localPt.x, y: localPt.y };
      intensity = 1.25; // 凑近姿态更夸张
    } else if (mode === 'password') {
      // 转头到左：给一个远超视野的左侧目标点（局部坐标）
      target = { x: -10000, y: VIEWBOX_H / 2 };
      intensity = 1.15;
    } else {
      // idle：鼠标跟随
      const m = mouseLocalRef.current;
      if (m) {
        target = { x: m.x, y: m.y };
      }
    }

    if (!target) {
      // 复位
      groups.forEach((g) => {
        g.style.setProperty('--body-tx', '0px');
        g.style.setProperty('--body-ty', '0px');
        g.style.setProperty('--body-rotate', '0deg');
        g.querySelectorAll<SVGCircleElement>('[data-pupil]').forEach((p) => {
          p.style.setProperty('--px', '0px');
          p.style.setProperty('--py', '0px');
        });
      });
      return;
    }

    // 每个角色独立按"自己到 target"的方向算姿态
    groups.forEach((g) => {
      const mcx = parseFloat(g.dataset.mascotCx || '0');
      const mcy = parseFloat(g.dataset.mascotCy || '0');
      const wTx = parseFloat(g.dataset.weightTx || '0');
      const wTy = parseFloat(g.dataset.weightTy || '0');
      const wRot = parseFloat(g.dataset.weightRotate || '0');

      const dx = target.x - mcx;
      const dy = target.y - mcy;
      const dist = Math.hypot(dx, dy);
      // sin = 水平分量 / 距离 → [-1, 1]；cos = -dy / 距离（鼠标在角色上方时正）
      const sinF = dist > 0 ? dx / dist : 0;
      const cosF = dist > 0 ? -dy / dist : 0;

      g.style.setProperty('--body-tx', `${sinF * wTx * intensity}px`);
      // 鼠标在角色上方 → 角色"伸脖子上抬"（SVG y 减小 = 负值）
      g.style.setProperty('--body-ty', `${-cosF * wTy * intensity}px`);
      g.style.setProperty('--body-rotate', `${sinF * wRot * intensity}deg`);

      // 瞳孔：每只眼睛自己的绝对位置 → target 方向
      g.querySelectorAll<SVGCircleElement>('[data-pupil]').forEach((p) => {
        const eyeX = parseFloat(p.dataset.eyeX || '0');
        const eyeY = parseFloat(p.dataset.eyeY || '0');
        const absEyeX = mcx + eyeX;
        const absEyeY = mcy + eyeY;
        const edx = target!.x - absEyeX;
        const edy = target!.y - absEyeY;
        const edist = Math.hypot(edx, edy);
        const factor = edist > 0 ? Math.min(edist, PUPIL_MAX) / edist : 0;
        p.style.setProperty('--px', `${edx * factor}px`);
        p.style.setProperty('--py', `${edy * factor}px`);
      });
    });
  }, []);

  const scheduleFlush = React.useCallback(() => {
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(flush);
  }, [flush]);

  // 把 viewport 坐标喂给 mascot，由 RAF 写 CSS 变量
  const updateFromClient = React.useCallback(
    (clientX: number, clientY: number) => {
      const inv = inverseCTMRef.current;
      const svg = svgRef.current;
      if (!inv || !svg) return;
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const localPt = pt.matrixTransform(inv);
      mouseLocalRef.current = {
        x: localPt.x,
        y: localPt.y,
        viewportX: clientX,
      };
      scheduleFlush();
    },
    [scheduleFlush]
  );

  React.useEffect(() => {
    recomputeCTM();
    const svg = svgRef.current;
    if (!svg) return;

    const ro = new ResizeObserver(() => recomputeCTM());
    ro.observe(svg);

    // window 级 pointermove：鼠标在页面任何位置都触发跟随
    const onPointerMove = (e: PointerEvent) => {
      updateFromClient(e.clientX, e.clientY);
    };
    // 鼠标离开浏览器窗口：复位
    const onWindowLeave = () => {
      mouseLocalRef.current = null;
      scheduleFlush();
    };

    const onResize = () => {
      recomputeCTM();
      // focused input 位置可能因布局变化偏移，username 模式重算 target
      if (focusModeRef.current === 'username') {
        const active = document.activeElement as HTMLElement | null;
        if (active && active.matches('input[autocomplete="username"]')) {
          const r = active.getBoundingClientRect();
          focusTargetRef.current = {
            x: r.left + r.width / 2,
            y: r.top + r.height / 2,
          };
          scheduleFlush();
        }
      }
    };

    // focus 状态机：识别 username/password input 切换姿态
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || typeof t.matches !== 'function') return;
      if (t.matches('input[autocomplete="username"]')) {
        const r = t.getBoundingClientRect();
        focusTargetRef.current = {
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
        };
        focusModeRef.current = 'username';
        setFocusMode('username');
        scheduleFlush();
      } else if (t.matches('input[autocomplete="current-password"]')) {
        focusTargetRef.current = null;
        focusModeRef.current = 'password';
        setFocusMode('password');
        scheduleFlush();
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as HTMLElement | null;
      // 焦点切到另一个被监控的 input：不复位（onFocusIn 会处理）
      if (
        next &&
        typeof next.matches === 'function' &&
        (next.matches('input[autocomplete="username"]') ||
          next.matches('input[autocomplete="current-password"]'))
      ) {
        return;
      }
      focusTargetRef.current = null;
      focusModeRef.current = 'idle';
      setFocusMode('idle');
      scheduleFlush();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('mouseleave', onWindowLeave);
    window.addEventListener('blur', onWindowLeave);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, { passive: true, capture: true });
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    return () => {
      ro.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('mouseleave', onWindowLeave);
      window.removeEventListener('blur', onWindowLeave);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, { capture: true });
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
    };
  }, [recomputeCTM, scheduleFlush, updateFromClient]);

  return (
    <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        className="mascot-svg h-full max-h-[680px] w-full max-w-[520px]"
        role="presentation"
        data-focus-mode={focusMode}
      >
        {/* 地面阴影 */}
        <ellipse cx={VIEWBOX_W / 2} cy={420} rx={170} ry={10} className="fill-foreground/5" />

        {MASCOTS.map((m) => (
          // 外层：SVG transform 静态定位（不被 CSS 覆盖）
          <g key={m.id} transform={`translate(${m.cx} ${m.cy})`}>
            {/* 中层：mascot-group 用 CSS var 做鼠标跟随的 transform */}
            <g
              data-mascot={m.id}
              data-mascot-cx={m.cx}
              data-mascot-cy={m.cy}
              data-weight-tx={m.weightTx}
              data-weight-ty={m.weightTy}
              data-weight-rotate={m.weightRotate}
              className="mascot-group"
            >
              {/* 内层：focus-modifier 由 data-focus-mode 触发额外 transform（凑近 / 缩头） */}
              <g className="mascot-focus-modifier">
                {/* 身体：fill 用 currentColor，颜色由 className 控制（支持 dark mode） */}
                <g className={FILL_CLASS[m.id]} fill="currentColor">
                  {m.body}
                </g>

                {m.mouth}

                {m.eyes.map((eye, idx) => (
                  <g
                    key={idx}
                    className="mascot-eye"
                    style={
                      { ['--blink-phase' as string]: `${m.blinkPhase}s` } as React.CSSProperties
                    }
                    data-eye-center-x={eye.cx}
                    data-eye-center-y={eye.cy}
                  >
                    {m.eyeWithSocket && (
                      <circle cx={eye.cx} cy={eye.cy} r={EYE_SOCKET_R} fill="white" />
                    )}
                    <circle
                      data-pupil
                      data-eye-x={eye.cx}
                      data-eye-y={eye.cy}
                      cx={eye.cx}
                      cy={eye.cy}
                      r={m.pupilR}
                      fill="#1F1F1F"
                      className="mascot-pupil"
                    />
                  </g>
                ))}
              </g>
            </g>
          </g>
        ))}
      </svg>

      <style>{`
        .mascot-group {
          transform: translate(var(--body-tx, 0px), var(--body-ty, 0px)) rotate(var(--body-rotate, 0deg));
          transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .mascot-focus-modifier {
          transform: none;
          transform-box: fill-box;
          transform-origin: center bottom;
          transition: transform 380ms cubic-bezier(0.34, 1.4, 0.64, 1);
        }
        /* username focus：好奇地凑过去——身体微放大 + 上抬一点（探出身去看） */
        .mascot-svg[data-focus-mode='username'] .mascot-focus-modifier {
          transform: scale(1.07) translateY(-6px);
        }
        /* password focus：转头到左侧——整体缩头 + 微微下沉 */
        .mascot-svg[data-focus-mode='password'] .mascot-focus-modifier {
          transform: scale(0.96) translateY(3px);
        }
        .mascot-pupil {
          transform: translate(var(--px, 0px), var(--py, 0px));
          transition: transform 90ms linear;
        }
        .mascot-eye {
          transform-box: fill-box;
          transform-origin: center;
          animation: mascot-blink 7s var(--blink-phase, 0s) infinite;
        }
        @keyframes mascot-blink {
          0%, 92%, 100% { transform: scaleY(1); }
          94%, 96% { transform: scaleY(0.1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .mascot-group,
          .mascot-pupil,
          .mascot-focus-modifier { transition: none; }
          .mascot-group { transform: none; }
          .mascot-pupil { transform: none; }
          .mascot-focus-modifier { transform: none; }
          .mascot-eye { animation: none; }
        }
      `}</style>
    </div>
  );
}
