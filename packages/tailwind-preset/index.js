/** @type {import('tailwindcss').Config} */
// GENERATED FILE — DO NOT EDIT. Source: tokens/tokens.json · Regenerate: pnpm gen · v0.1.0-rc
const semanticTextPlugin = ({ addUtilities }) => {
  addUtilities({
    '.text-disabled': {
      color: 'var(--color-text-disabled)'
    },
    '.text-primary': {
      color: 'var(--color-text-primary)'
    },
    '.text-secondary': {
      color: 'var(--color-text-secondary)'
    },
    '.text-muted': {
      color: 'var(--color-text-muted)'
    }
  });
};
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          '50': 'rgb(var(--color-primary-50-rgb))',
          '100': 'rgb(var(--color-primary-100-rgb))',
          '200': 'rgb(var(--color-primary-200-rgb))',
          '300': 'rgb(var(--color-primary-300-rgb))',
          '400': 'rgb(var(--color-primary-400-rgb))',
          '500': 'rgb(var(--color-primary-500-rgb))',
          '600': 'rgb(var(--color-primary-600-rgb))',
          '700': 'rgb(var(--color-primary-700-rgb))',
          '800': 'rgb(var(--color-primary-800-rgb))',
          '900': 'rgb(var(--color-primary-900-rgb))'
        },
        sky: {
          '50': 'rgb(var(--color-sky-50-rgb))',
          '100': 'rgb(var(--color-sky-100-rgb))',
          '200': 'rgb(var(--color-sky-200-rgb))',
          '300': 'rgb(var(--color-sky-300-rgb))',
          '400': 'rgb(var(--color-sky-400-rgb))',
          '500': 'rgb(var(--color-sky-500-rgb))',
          '600': 'rgb(var(--color-sky-600-rgb))',
          '700': 'rgb(var(--color-sky-700-rgb))',
          '800': 'rgb(var(--color-sky-800-rgb))',
          '900': 'rgb(var(--color-sky-900-rgb))'
        },
        amber: {
          '50': 'rgb(var(--color-amber-50-rgb))',
          '100': 'rgb(var(--color-amber-100-rgb))',
          '200': 'rgb(var(--color-amber-200-rgb))',
          '300': 'rgb(var(--color-amber-300-rgb))',
          '400': 'rgb(var(--color-amber-400-rgb))',
          '500': 'rgb(var(--color-amber-500-rgb))',
          '600': 'rgb(var(--color-amber-600-rgb))',
          '700': 'rgb(var(--color-amber-700-rgb))',
          '800': 'rgb(var(--color-amber-800-rgb))',
          '900': 'rgb(var(--color-amber-900-rgb))'
        },
        neutral: {
          '0': 'rgb(var(--color-neutral-0-rgb))',
          '50': 'rgb(var(--color-neutral-50-rgb))',
          '100': 'rgb(var(--color-neutral-100-rgb))',
          '200': 'rgb(var(--color-neutral-200-rgb))',
          '300': 'rgb(var(--color-neutral-300-rgb))',
          '400': 'rgb(var(--color-neutral-400-rgb))',
          '500': 'rgb(var(--color-neutral-500-rgb))',
          '600': 'rgb(var(--color-neutral-600-rgb))',
          '700': 'rgb(var(--color-neutral-700-rgb))',
          '800': 'rgb(var(--color-neutral-800-rgb))',
          '900': 'rgb(var(--color-neutral-900-rgb))'
        },
        chart: {
          '1': 'rgb(var(--color-chart-1-rgb))',
          '2': 'rgb(var(--color-chart-2-rgb))',
          '3': 'rgb(var(--color-chart-3-rgb))',
          '4': 'rgb(var(--color-chart-4-rgb))',
          '5': 'rgb(var(--color-chart-5-rgb))',
          '6': 'rgb(var(--color-chart-6-rgb))',
          '7': 'rgb(var(--color-chart-7-rgb))',
          '8': 'rgb(var(--color-chart-8-rgb))'
        },
        method: {
          get: 'rgb(var(--color-method-get-rgb))',
          post: 'rgb(var(--color-method-post-rgb))',
          put: 'rgb(var(--color-method-put-rgb))',
          patch: 'rgb(var(--color-method-patch-rgb))',
          delete: 'rgb(var(--color-method-delete-rgb))',
          head: 'rgb(var(--color-method-head-rgb))'
        },
        syntax: {
          plain: 'rgb(var(--color-syntax-plain-rgb))',
          comment: 'rgb(var(--color-syntax-comment-rgb))',
          keyword: 'rgb(var(--color-syntax-keyword-rgb))',
          string: 'rgb(var(--color-syntax-string-rgb))',
          number: 'rgb(var(--color-syntax-number-rgb))',
          function: 'rgb(var(--color-syntax-function-rgb))',
          type: 'rgb(var(--color-syntax-type-rgb))',
          tag: 'rgb(var(--color-syntax-tag-rgb))'
        },
        success: 'rgb(var(--color-success-rgb))',
        warning: 'rgb(var(--color-warning-rgb))',
        danger: 'rgb(var(--color-danger-rgb))',
        'success-soft': 'rgb(var(--color-success-soft-rgb))',
        'warning-soft': 'rgb(var(--color-warning-soft-rgb))',
        'danger-soft': 'rgb(var(--color-danger-soft-rgb))',
        'success-text': 'rgb(var(--color-success-text-rgb))',
        'warning-text': 'rgb(var(--color-warning-text-rgb))',
        'danger-text': 'rgb(var(--color-danger-text-rgb))',
        error: 'rgb(var(--color-danger-rgb))',
        info: 'rgb(var(--color-info-rgb))',
        'info-text': 'rgb(var(--color-info-text-rgb))',
        'info-soft': 'rgb(var(--color-info-soft-rgb))',
        brand: 'rgb(var(--color-brand-rgb))',
        'brand-hover': 'rgb(var(--color-brand-hover-rgb))',
        'brand-soft': 'rgb(var(--color-brand-soft-rgb))',
        'brand-active': 'rgb(var(--color-brand-active-rgb))',
        'brand-text': 'rgb(var(--color-brand-text-rgb))',
        accent: 'rgb(var(--color-accent-rgb))',
        inverse: 'rgb(var(--color-text-inverse-rgb))',
        surface: 'rgb(var(--color-bg-surface-rgb))',
        muted: 'rgb(var(--color-bg-muted-rgb))',
        elevated: 'rgb(var(--color-bg-elevated-rgb))',
        developer: 'rgb(var(--color-bg-developer-rgb))',
        'border-subtle': 'rgb(var(--color-border-subtle-rgb))',
        'border-strong': 'rgb(var(--color-border-strong-rgb))'
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'sans-serif'],
        serif: ['Source Han Serif SC', 'Noto Serif SC', 'serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace']
      },
      fontSize: {
        xs: ['12px', {
          lineHeight: '16px'
        }],
        sm: ['14px', {
          lineHeight: '20px'
        }],
        base: ['16px', {
          lineHeight: '24px'
        }],
        lg: ['18px', {
          lineHeight: '28px',
          fontWeight: '500'
        }],
        xl: ['20px', {
          lineHeight: '28px',
          fontWeight: '600'
        }],
        '2xl': ['24px', {
          lineHeight: '32px',
          fontWeight: '700'
        }],
        '3xl': ['30px', {
          lineHeight: '36px',
          fontWeight: '700'
        }],
        '4xl': ['36px', {
          lineHeight: '40px'
        }],
        'display-2xl': ['72px', {
          lineHeight: '1.16',
          fontWeight: '800',
          letterSpacing: '-0.02em'
        }],
        'display-xl': ['48px', {
          lineHeight: '1.16',
          fontWeight: '800',
          letterSpacing: '-0.02em'
        }],
        'display-lg': ['40px', {
          lineHeight: '1.2',
          fontWeight: '800',
          letterSpacing: '-0.015em'
        }],
        'heading-lg': ['30px', {
          lineHeight: '1.35',
          fontWeight: '700',
          letterSpacing: '-0.01em'
        }],
        'heading-md': ['22px', {
          lineHeight: '1.45',
          fontWeight: '700',
          letterSpacing: '0'
        }],
        'body-lg': ['18px', {
          lineHeight: '1.75'
        }],
        'body-md': ['16px', {
          lineHeight: '1.75'
        }],
        'body-sm': ['14px', {
          lineHeight: '1.6'
        }],
        'label-md': ['14px', {
          lineHeight: '1.43',
          fontWeight: '600'
        }],
        'label-caps': ['12px', {
          lineHeight: '1.35',
          fontWeight: '600',
          letterSpacing: '0.12em'
        }],
        'code-md': ['14px', {
          lineHeight: '1.75'
        }]
      },
      spacing: {
        '1': '4px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '8': '32px',
        '10': '40px',
        '12': '48px',
        '16': '64px',
        '20': '80px',
        '0.5': '2px',
        '1.5': '6px',
        '2.5': '10px',
        '3.5': '14px',
        'section-gap': '48px',
        '$density-note': '控件密度档（0.5/1.5/2.5/3.5 = 2/6/10/14px）。第 55 轮实测：全舰队 530 处在用它，几乎全部落在「控件内部」——徽标内边距、行内元素之间的 gap、密集表格的行高留白。它们此前只在 Tailwind 出厂主题里存在，设计系统既不承认也不否认，于是「6px 到底算不算合规」没有答案。现在把它们收进 SSOT：值与 Tailwind 出厂逐字相同，所以是零视觉变化；意义是这套值从「没登记的野值」变成「有名字、有适用域的档位」——判据因此可以写成「控件内部允许密度档，区块与页面级只走整档」，而不是一张黑白名单。',
        '$rhythm-note': '页面节奏档。第 55 轮修正了三件事：① 补上 16(64px) / 20(80px)——全舰队实测 64px 有 50 处、80px 有 35 处（内容站的节与 hero），而此前的阶梯到 48px 就断了，于是「规定不够用」被读成「站点越界」，两类东西混在一条台账里；② 删除 hero-gap(40px)——它没有任何消费者，且与 space-10 同值，属于「一个值两个名字」的债，留着只会让「该用哪个」继续没有答案；③ 保留 section-gap(48px)——它是唯一有消费者的语义节奏名（primitives.css）。节奏仍然有名字，但名字必须有人用：**令牌没有消费者就是债，不是能力。**'
      },
      transitionDuration: {
        '100': '100ms',
        '150': '150ms',
        '200': '200ms',
        '300': '300ms',
        '500': '500ms',
        '1000': '1000ms'
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
        in: 'cubic-bezier(0.4, 0, 1, 1)',
        'in-out': 'cubic-bezier(0.65, 0, 0.35, 1)',
        linear: 'cubic-bezier(0, 0, 1, 1)'
      },
      borderRadius: {
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '28px',
        xxl: '32px',
        full: '9999px',
        $note: '第 55 轮新增 xs(4px)。DESIGN.md §9 一直写着「inline chips and code tighter」，但最紧的档位是 sm(8px)——于是舰队用裸 rounded（Tailwind 出厂 4px）表达了 109 处。这不是 109 个人同时犯错，而是**规格里少了一档**：给「更紧」一个名字，野值就变成档位。取值与舰队现状逐字相同（4px），所以是零视觉变化。'
      },
      boxShadow: {
        soft: '0 8px 20px rgba(0, 49, 83, 0.08)',
        card: '0 12px 36px rgba(0, 49, 83, 0.10)',
        brand: '0 24px 80px rgba(0, 49, 83, 0.14)',
        code: '0 24px 60px rgba(3, 20, 37, 0.18)',
        deep: '0 32px 120px rgba(3, 20, 37, 0.38)',
        $note: 'code / deep 是从 primitives.css 里**收进来**的，不是新设计。primitives.css 声称「只消费 var()」，但代码块与开发者面板两处直接写死了 box-shadow（U66 第⑦项）。收进令牌后取值与原来**逐字相同**，所以是零视觉变化；意义在于这两处阴影从此可被集中调整，而不是散在组件的样式里。另外注意它们的色相与前三个不同：前三个用 primary-700 的 rgb(0,49,83)，这两个用 bg-developer 的 rgb(3,20,37)——深色面板上的阴影本就该更深。**第 55 轮补记（角色口径）**：这五档是一套语言，不是一个色板——soft=小控件/标签的轻微抬起，card=卡片与容器（DESIGN.md §9 指定），brand=大外壳与浮层组，code/deep=深色技术面板。第 55 轮实测发现设计系统自己的组件用的是 Tailwind 出厂的 shadow-sm / shadow-lg（中性黑），而内容站与 docs/developer 两套 profile 用的是这一族（品牌色调）——同一个站的页面上因此同时存在两种阴影语言。第 55 轮已把 13 处全部收敛到这一族（卡片 → card、浮层 → brand、裸 rounded → xs），没有为此扩一档中性阴影 —— 这一族就是唯一语言。'
      },
      zIndex: {
        base: '0',
        dropdown: '1000',
        sticky: '1020',
        fixed: '1030',
        'modal-backdrop': '1040',
        modal: '1050',
        popover: '1060',
        toast: '1070',
        tooltip: '1080'
      },
      backgroundImage: {
        'brand-radial': 'var(--image-brand-radial)',
        'brand-grid': 'var(--image-brand-grid)',
        'page-light': 'var(--image-page-light)',
        'page-dark': 'var(--image-page-dark)'
      }
    }
  }
};
module.exports.plugins = [semanticTextPlugin];
