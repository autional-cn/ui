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
        'hero-gap': '40px',
        'section-gap': '48px',
        '$rhythm-note': '命名节奏档。U66 第⑫项：「hero-gap / section-gap 命名令牌迁移丢失（值仍在 space-10/12）」。这是「页面模式层」缺失的一个症状——数值还在，但**语义名字没了**，于是每个内容站只能自己决定「一节之间留多少」，各留各的。值与原 space-10 / space-12 完全相同，所以是零视觉变化；意义在于节奏从此有名字、可被集中调。'
      },
      borderRadius: {
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '28px',
        xxl: '32px',
        full: '9999px'
      },
      boxShadow: {
        soft: '0 8px 20px rgba(0, 49, 83, 0.08)',
        card: '0 12px 36px rgba(0, 49, 83, 0.10)',
        brand: '0 24px 80px rgba(0, 49, 83, 0.14)',
        code: '0 24px 60px rgba(3, 20, 37, 0.18)',
        deep: '0 32px 120px rgba(3, 20, 37, 0.38)',
        $note: 'code / deep 是从 primitives.css 里**收进来**的，不是新设计。primitives.css 声称「只消费 var()」，但代码块与开发者面板两处直接写死了 box-shadow（U66 第⑦项）。收进令牌后取值与原来**逐字相同**，所以是零视觉变化；意义在于这两处阴影从此可被集中调整，而不是散在组件的样式里。另外注意它们的色相与前三个不同：前三个用 primary-700 的 rgb(0,49,83)，这两个用 bg-developer 的 rgb(3,20,37)——深色面板上的阴影本就该更深。'
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
