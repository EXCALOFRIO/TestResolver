import React from 'react';

export const PaperclipIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21.44 11.05l-8.49 8.49a5.25 5.25 0 11-7.42-7.43l9.19-9.18a3.5 3.5 0 114.95 4.95l-9.19 9.19a1.75 1.75 0 11-2.47-2.48l8.49-8.49"
    />
  </svg>
);
