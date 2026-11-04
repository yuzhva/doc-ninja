import React from 'react';
import { NavLink } from 'react-router';

// import { SidebarExample } from './SidebarExample';

interface SidebarProps {
  isSidebarOpen: boolean;
}

interface SidebarItemProps {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const SIDEBAR_GROUPS: SidebarItemProps[][] = [
  [
    {
      label: 'Пошук в документах',
      href: '/',
      // A document under a magnifying glass (Heroicons
      // "document-magnifying-glass").
      icon: (
        <svg
          stroke="currentColor"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-6 w-6 flex-shrink-0 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
          data-testid="flowbite-sidebar-item-icon"
          height="1em"
          width="1em"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Zm3.75 11.625a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
        </svg>
      ),
    },
  ],
  [
    {
      label: 'Утиліти для документів',
      href: '/process',
      // A wrench and a screwdriver — the usual "tools" sign (Heroicons
      // "wrench-screwdriver").
      icon: (
        <svg
          stroke="currentColor"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-6 w-6 flex-shrink-0 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
          data-testid="flowbite-sidebar-item-icon"
          height="1em"
          width="1em"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
        </svg>
      ),
    },
  ],
  /*
  [
    {
      label: 'Docs',
      href: 'https://github.com/themesberg/flowbite-react/',
      icon: (
        <svg
          stroke="currentColor"
          fill="currentColor"
          strokeWidth="0"
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="h-6 w-6 flex-shrink-0 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
          data-testid="flowbite-sidebar-item-icon"
          height="1em"
          width="1em"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"></path>
          <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"></path>
        </svg>
      ),
    },
    {
      label: 'Components',
      href: 'https://flowbite-react.com/',
      icon: (
        <svg
          stroke="currentColor"
          fill="currentColor"
          strokeWidth="0"
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="h-6 w-6 flex-shrink-0 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
          data-testid="flowbite-sidebar-item-icon"
          height="1em"
          width="1em"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z"></path>
        </svg>
      ),
    },
    {
      label: 'Help',
      href: 'https://github.com/themesberg/flowbite-react/issues',
      icon: (
        <svg
          stroke="currentColor"
          fill="currentColor"
          strokeWidth="0"
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="h-6 w-6 flex-shrink-0 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
          data-testid="flowbite-sidebar-item-icon"
          height="1em"
          width="1em"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
            clipRule="evenodd"
          ></path>
        </svg>
      ),
    },
  ],
  */
];

const SidebarItem = ({
  item,
  isSidebarOpen,
}: {
  item: SidebarItemProps;
  isSidebarOpen: boolean;
}) => {
  const { label, href, icon } = item;
  const id = `sidebar-item-${label.toLowerCase().replace(/\s+/g, '-')}`;
  const isExternal = href.startsWith('http');

  // Base styling for all links
  const baseClassName =
    'flex items-center justify-center rounded-lg p-2 text-base font-medium text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700 transition-colors';
  // Active styling added when route matches
  const activeClassName = 'bg-gray-100 dark:bg-gray-700';

  const LinkComponent = ({
    children,
    ariaLabelledBy,
    className,
    ...props
  }: any) => {
    // If className is provided as a prop override (container), we might append base.
    // However, in this component layout, className passed from render is mostly just layout if any.
    // Actually, looking at usage below, className passed is currently the full tailwind string.
    // I will ignore the passed className prop for style logic to keep it centralized here,
    // or assume the caller passes structural classes only?
    // In previous code, I duplicated the big string in render.
    // Let's use the local constants instead.

    if (isExternal) {
      return (
        <a
          aria-labelledby={ariaLabelledBy}
          href={href}
          className={`${baseClassName} ${className || ''}`}
          target="_blank"
          rel="noopener noreferrer"
          {...props}
        >
          {children}
        </a>
      );
    }

    return (
      <NavLink
        aria-labelledby={ariaLabelledBy}
        to={href}
        className={({ isActive }) =>
          `${baseClassName} ${className || ''} ${
            isActive ? activeClassName : ''
          }`
        }
        {...props}
      >
        {children}
      </NavLink>
    );
  };

  const tooltipId = `tooltip-${id}`;

  return (
    <li>
      {isSidebarOpen ? (
        <LinkComponent
          ariaLabelledBy={id}
          // Removing the hardcoded bg-gray-100 classes from here since logic corresponds to NavLink/External now
        >
          {icon}
          <span
            className="px-3 flex-1 whitespace-nowrap"
            data-testid="flowbite-sidebar-item-content"
            id={id}
          >
            {label}
          </span>
        </LinkComponent>
      ) : (
        <>
          <div
            className="w-fit group relative"
            data-testid="flowbite-tooltip-target"
          >
            <LinkComponent
              ariaLabelledBy={id}
              // We remove data attributes as we fallback to CSS-only fixed positioning to escape overflow
            >
              {icon}
            </LinkComponent>

            {/* CSS-only Tooltip using fixed positioning to escape container overflow */}
            {/* 'fixed left-16' positions it right next to the 4rem (16) wide sidebar */}
            {/* We effectively pull the tooltip up to align with the item using negative margin (since static pos is below the item) */}
            <div
              id={tooltipId}
              role="tooltip"
              className="fixed left-16 z-50 invisible inline-block px-3 py-2 text-sm font-medium text-white transition-opacity duration-300 bg-gray-900 rounded-lg shadow-sm opacity-0 group-hover:visible group-hover:opacity-100 whitespace-nowrap dark:bg-gray-700 -mt-10 ml-2"
              style={{ top: 'auto' }}
            >
              {label}
              {/* Arrow: positioned absolute relative to the fixed tooltip */}
              <div
                className="absolute w-2 h-2 bg-gray-900 transform rotate-45 -left-1 top-1/2 -translate-y-1/2 dark:bg-gray-700"
                data-popper-arrow
              ></div>
            </div>
          </div>
        </>
      )}
    </li>
  );
};

const Sidebar = ({ isSidebarOpen }: SidebarProps) => {
  return (
    <div className={`lg:!block ${isSidebarOpen ? 'hidden' : ''}`}>
      <aside
        aria-label="Sidebar with multi-level dropdown example"
        className={
          isSidebarOpen
            ? 'flex fixed top-0 left-0 z-20 flex-col flex-shrink-0 pt-16 h-full duration-75 border-r border-gray-200 lg:flex transition-width dark:border-gray-700 w-64'
            : 'flex fixed top-0 left-0 z-20 flex-col flex-shrink-0 pt-16 h-full duration-75 border-r border-gray-200 lg:flex transition-width dark:border-gray-700 w-16'
        }
      >
        <div className="h-full overflow-y-auto overflow-x-hidden bg-white py-4 px-3 dark:bg-gray-800">
          <div className="flex h-full flex-col justify-between py-2">
            <div>
              <form className="pb-3 md:hidden">
                <div className="flex">
                  <div className="relative w-full">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <svg
                        stroke="currentColor"
                        fill="currentColor"
                        strokeWidth="0"
                        viewBox="0 0 20 20"
                        className="h-5 w-5 text-gray-500 dark:text-gray-400"
                        height="1em"
                        width="1em"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          fillRule="evenodd"
                          d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                          clipRule="evenodd"
                        ></path>
                      </svg>
                    </div>
                    <input
                      className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 pl-10 rounded-lg p-2.5 text-sm"
                      type="search"
                      placeholder="Search"
                      required=""
                      size="32"
                    />
                  </div>
                </div>
              </form>
              <div className="" data-testid="flowbite-sidebar-items">
                {SIDEBAR_GROUPS.map((group, groupIndex) => (
                  <ul
                    key={groupIndex}
                    className="mt-4 space-y-2 border-t border-gray-200 pt-4 first:mt-0 first:border-t-0 first:pt-0 dark:border-gray-700"
                    data-testid="flowbite-sidebar-item-group"
                  >
                    {group.map((item) => (
                      <SidebarItem
                        key={item.label}
                        item={item}
                        isSidebarOpen={isSidebarOpen}
                      />
                    ))}
                  </ul>
                ))}
              </div>
            </div>

            {/* Settings - Commented out in original */}
            {/*
            <div className="flex items-center justify-center gap-x-5">
              ...existing code...
            </div>
            */}
          </div>
        </div>
      </aside>
    </div>
  );
};

export { Sidebar };
