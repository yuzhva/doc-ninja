import React, { useState } from 'react';
import { NavLink } from 'react-router';

interface SidebarSubItem {
  label: string;
  href: string;
}

interface SidebarItemConfig {
  label: string;
  href?: string;
  icon: React.ReactNode;
  badge?: string;
  children?: SidebarSubItem[];
}

const EXAMPLE_ITEMS: SidebarItemConfig[] = [
  {
    label: 'Kanban',
    href: '/kanban',
    icon: (
      <svg
        stroke="currentColor"
        fill="currentColor"
        strokeWidth="0"
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="h-6 w-6 flex-shrink-0 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
        height="1em"
        width="1em"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path>
      </svg>
    ),
  },
  {
    label: 'Inbox',
    href: '/mailing/inbox',
    badge: '3',
    icon: (
      <svg
        stroke="currentColor"
        fill="currentColor"
        strokeWidth="0"
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="h-6 w-6 flex-shrink-0 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
        height="1em"
        width="1em"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M8.707 7.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l2-2a1 1 0 00-1.414-1.414L11 7.586V3a1 1 0 10-2 0v4.586l-.293-.293z"></path>
        <path d="M3 5a2 2 0 012-2h1a1 1 0 010 2H5v7h2l1 2h4l1-2h2V5h-1a1 1 0 110-2h1a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"></path>
      </svg>
    ),
  },
  {
    label: 'E-commerce',
    icon: (
      <svg
        stroke="currentColor"
        fill="currentColor"
        strokeWidth="0"
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="h-6 w-6 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
        height="1em"
        width="1em"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fillRule="evenodd"
          d="M10 2a4 4 0 00-4 4v1H5a1 1 0 00-.994.89l-1 9A1 1 0 004 18h12a1 1 0 00.994-1.11l-1-9A1 1 0 0015 7h-1V6a4 4 0 00-4-4zm2 5V6a2 2 0 10-4 0v1h4zm-6 3a1 1 0 112 0 1 1 0 01-2 0zm7-1a1 1 0 100 2 1 1 0 000-2z"
          clipRule="evenodd"
        ></path>
      </svg>
    ),
    children: [
      { label: 'Products', href: '/e-commerce/products' },
      { label: 'Billing', href: '/e-commerce/billing' },
      { label: 'Invoice', href: '/e-commerce/invoice' },
    ],
  },
  {
    label: 'Users',
    icon: (
      <svg
        stroke="currentColor"
        fill="currentColor"
        strokeWidth="0"
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="h-6 w-6 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
        height="1em"
        width="1em"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"></path>
      </svg>
    ),
    children: [
      { label: 'Users list', href: '/users/list' },
      { label: 'Profile', href: '/users/profile' },
      { label: 'Feed', href: '/users/feed' },
      { label: 'Settings', href: '/users/settings' },
    ],
  },
  {
    label: 'Pages',
    icon: (
      <svg
        stroke="currentColor"
        fill="currentColor"
        strokeWidth="0"
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="h-6 w-6 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
        height="1em"
        width="1em"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fillRule="evenodd"
          d="M5 3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2H5zm9 4a1 1 0 10-2 0v6a1 1 0 102 0V7zm-3 2a1 1 0 10-2 0v4a1 1 0 102 0V9zm-3 3a1 1 0 10-2 0v1a1 1 0 102 0v-1z"
          clipRule="evenodd"
        ></path>
      </svg>
    ),
    children: [
      { label: 'Pricing', href: '/pages/pricing' },
      { label: 'Maintenance', href: '/pages/maintenance' },
      { label: '404 not found', href: '/pages/404' },
      { label: '500 server error', href: '/pages/500' },
    ],
  },
  {
    label: 'Authentication',
    icon: (
      <svg
        stroke="currentColor"
        fill="currentColor"
        strokeWidth="0"
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="h-6 w-6 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
        height="1em"
        width="1em"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fillRule="evenodd"
          d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
          clipRule="evenodd"
        ></path>
      </svg>
    ),
    children: [
      { label: 'Sign in', href: '/authentication/sign-in' },
      { label: 'Sign up', href: '/authentication/sign-up' },
      { label: 'Forgot password', href: '/authentication/forgot-password' },
      { label: 'Reset password', href: '/authentication/reset-password' },
      { label: 'Profile lock', href: '/authentication/profile-lock' },
    ],
  },
];

const SidebarExampleItem = ({ item }: { item: SidebarItemConfig }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { label, href, icon, badge, children } = item;
  const id = `flowbite-sidebar-item-${label.toLowerCase().replace(/\s+/g, '-')}`;
  const collapseId = `flowbite-sidebar-collapse-${label.toLowerCase().replace(/\s+/g, '-')}`;

  const baseClassName =
    'flex items-center justify-center rounded-lg p-2 text-base font-medium text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700 transition-colors';
  const activeClassName = 'bg-gray-100 dark:bg-gray-700';

  if (children) {
    return (
      <li>
        <button
          className="group flex w-full items-center rounded-lg p-2 text-base font-medium text-gray-900 transition duration-75 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700"
          id={collapseId}
          type="button"
          onClick={() => setIsOpen(!isOpen)}
        >
          {icon}
          <span
            className="ml-3 flex-1 whitespace-nowrap text-left"
            data-testid="flowbite-sidebar-collapse-label"
          >
            {label}
          </span>
          <svg
            stroke="currentColor"
            fill="currentColor"
            strokeWidth="0"
            viewBox="0 0 20 20"
            aria-hidden="true"
            className={`h-6 w-6 transition-transform ${isOpen ? '' : 'rotate-180'}`}
            height="1em"
            width="1em"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            ></path>
          </svg>
        </button>
        <ul
          aria-labelledby={collapseId}
          className={`${isOpen ? '' : 'hidden'} space-y-2 py-2`}
        >
          {children.map((sub, idx) => {
            const subId = `flowbite-sidebar-item-${sub.label.toLowerCase().replace(/\s+/g, '-')}`;
            return (
              <li key={idx}>
                <NavLink
                  to={sub.href}
                  aria-labelledby={subId}
                  className={({ isActive }) =>
                    `flex items-center justify-center rounded-lg p-2 text-base font-medium text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700 group w-full pl-8 transition duration-75 ${
                      isActive ? activeClassName : ''
                    }`
                  }
                >
                  <span
                    className="px-3 flex-1 whitespace-nowrap"
                    data-testid="flowbite-sidebar-item-content"
                    id={subId}
                  >
                    {sub.label}
                  </span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </li>
    );
  }

  return (
    <li>
      <NavLink
        to={href || '#'}
        aria-labelledby={id}
        className={({ isActive }) =>
          `${baseClassName} ${isActive ? activeClassName : ''}`
        }
      >
        {icon}
        <span
          className="px-3 flex-1 whitespace-nowrap"
          data-testid="flowbite-sidebar-item-content"
          id={id}
        >
          {label}
        </span>
        {badge && (
          <span
            className="flex h-fit items-center gap-1 font-semibold bg-blue-100 text-blue-800 dark:bg-blue-200 dark:text-blue-800 group-hover:bg-blue-200 dark:group-hover:bg-blue-300 rounded-full px-2 py-1 p-1 text-xs"
            data-testid="flowbite-sidebar-label"
          >
            <span>{badge}</span>
          </span>
        )}
      </NavLink>
    </li>
  );
};

const MoreMenuOptions = () => {
  return (
    <>
      {EXAMPLE_ITEMS.map((item) => (
        <SidebarExampleItem key={item.label} item={item} />
      ))}
    </>
  );
};

const SidebarExample = {
  MoreMenuOptions,
};

export { SidebarExample };
