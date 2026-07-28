import React from 'react'
import styles from './Button.module.css'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps): JSX.Element {
  const cls = [styles.btn, styles[variant], styles[size], className].filter(Boolean).join(' ')
  return (
    <button className={cls} {...props}>
      {children}
    </button>
  )
}
