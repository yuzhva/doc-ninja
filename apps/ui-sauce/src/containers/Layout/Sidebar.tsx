import React from 'react';

// import { SidebarExample } from './SidebarExample';

const Sidebar = ({ isSidebarOpen }) => {
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
        <div className="h-full overflow-y-auto overflow-x-hidden rounded bg-white py-4 px-3 dark:bg-gray-800">
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
                <ul
                  className="mt-4 space-y-2 border-t border-gray-200 pt-4 first:mt-0 first:border-t-0 first:pt-0 dark:border-gray-700"
                  data-testid="flowbite-sidebar-item-group"
                >
                  <li>
                    {isSidebarOpen ? (
                      <a
                        aria-labelledby="flowbite-sidebar-item-:r6:"
                        className="flex items-center justify-center rounded-lg p-2 text-base font-medium text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700 bg-gray-100 dark:bg-gray-700"
                        href="/"
                      >
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
                          <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z"></path>
                          <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z"></path>
                        </svg>
                        <span
                          className="px-3 flex-1 whitespace-nowrap"
                          data-testid="flowbite-sidebar-item-content"
                          id="flowbite-sidebar-item-:r6:"
                        >
                          Dashboard
                        </span>
                      </a>
                    ) : (
                      <>
                        <div
                          className="w-fit"
                          data-testid="flowbite-tooltip-target"
                        >
                          <a
                            aria-labelledby="flowbite-sidebar-item-:r6:"
                            className="flex items-center justify-center rounded-lg p-2 text-base font-medium text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700 bg-gray-100 dark:bg-gray-700"
                            href="/"
                          >
                            <svg
                              stroke="currentColor"
                              fill="currentColor"
                              stroke-width="0"
                              viewBox="0 0 20 20"
                              aria-hidden="true"
                              className="h-6 w-6 flex-shrink-0 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
                              data-testid="flowbite-sidebar-item-icon"
                              height="1em"
                              width="1em"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z"></path>
                              <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z"></path>
                            </svg>
                          </a>
                        </div>
                        <div
                          data-testid="flowbite-tooltip"
                          tabIndex="-1"
                          className="absolute inline-block z-10 rounded-lg py-2 px-3 text-sm font-medium shadow-sm transition-opacity duration-300 invisible opacity-0 bg-gray-900 text-white dark:bg-gray-700"
                          id=":rkp:"
                          role="tooltip"
                          style={{
                            position: 'absolute',
                            top: '90px',
                            left: '60px',
                          }}
                        >
                          <div className="relative z-20">
                            <span
                              className="px-3 flex-1 whitespace-nowrap"
                              data-testid="flowbite-sidebar-item-content"
                              id="flowbite-sidebar-item-:r6:"
                            >
                              Dashboard
                            </span>
                          </div>
                          <div
                            className="absolute z-10 h-2 w-2 rotate-45 bg-gray-900 dark:bg-gray-700"
                            data-testid="flowbite-tooltip-arrow"
                            style={{ left: '-4px', top: '14px' }}
                          >
                            &nbsp;
                          </div>
                        </div>
                      </>
                    )}
                  </li>

                  {/*
                  <SidebarExample.MoreMenuOptions />
                  */}
                </ul>
                <ul
                  className="mt-4 space-y-2 border-t border-gray-200 pt-4 first:mt-0 first:border-t-0 first:pt-0 dark:border-gray-700"
                  data-testid="flowbite-sidebar-item-group"
                >
                  <li>
                    {isSidebarOpen ? (
                      <a
                        aria-labelledby="flowbite-sidebar-item-:rt:"
                        className="flex items-center justify-center rounded-lg p-2 text-base font-medium text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700"
                        href="https://github.com/themesberg/flowbite-react/"
                      >
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
                        <span
                          className="px-3 flex-1 whitespace-nowrap"
                          data-testid="flowbite-sidebar-item-content"
                          id="flowbite-sidebar-item-:rt:"
                        >
                          Docs
                        </span>
                      </a>
                    ) : (
                      <>
                        <div
                          className="w-fit"
                          data-testid="flowbite-tooltip-target"
                        >
                          <a
                            aria-labelledby="flowbite-sidebar-item-:r27:"
                            className="flex items-center justify-center rounded-lg p-2 text-base font-medium text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700"
                            href="https://github.com/themesberg/flowbite-react/"
                          >
                            <svg
                              stroke="currentColor"
                              fill="currentColor"
                              stroke-width="0"
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
                          </a>
                        </div>
                        <div
                          data-testid="flowbite-tooltip"
                          tabIndex="-1"
                          className="absolute inline-block z-10 rounded-lg py-2 px-3 text-sm font-medium shadow-sm transition-opacity duration-300 invisible opacity-0 bg-gray-900 text-white dark:bg-gray-700"
                          id=":r1u5:"
                          role="tooltip"
                          style={{"position": "absolute", "top": "451px", "left": "60px"}}
                        >
                          <div className="relative z-20">
                            <span
                              className="px-3 flex-1 whitespace-nowrap"
                              data-testid="flowbite-sidebar-item-content"
                              id="flowbite-sidebar-item-:r27:"
                            >
                              Docs
                            </span>
                          </div>
                          <div
                            className="absolute z-10 h-2 w-2 rotate-45 bg-gray-900 dark:bg-gray-700"
                            data-testid="flowbite-tooltip-arrow"
                            style={{"left": "-4px", "top": "14px"}}
                          >
                            &nbsp;
                          </div>
                        </div>
                      </>
                    )}
                  </li>
                  <li>
                    {isSidebarOpen ? (
                      <a
                        aria-labelledby="flowbite-sidebar-item-:ru:"
                        className="flex items-center justify-center rounded-lg p-2 text-base font-medium text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700"
                        href="https://flowbite-react.com/"
                      >
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
                        <span
                          className="px-3 flex-1 whitespace-nowrap"
                          data-testid="flowbite-sidebar-item-content"
                          id="flowbite-sidebar-item-:ru:"
                        >
                          Components
                        </span>
                      </a>
                    ) : (
                      <>
                        <div
                          className="w-fit"
                          data-testid="flowbite-tooltip-target"
                        >
                          <a
                            aria-labelledby="flowbite-sidebar-item-:r2a:"
                            className="flex items-center justify-center rounded-lg p-2 text-base font-medium text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700"
                            href="https://flowbite-react.com/"
                          >
                            <svg
                              stroke="currentColor"
                              fill="currentColor"
                              stroke-width="0"
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
                          </a>
                        </div>
                        <div
                          data-testid="flowbite-tooltip"
                          tabIndex="-1"
                          className="absolute inline-block z-10 rounded-lg py-2 px-3 text-sm font-medium shadow-sm transition-opacity duration-300 invisible opacity-0 bg-gray-900 text-white dark:bg-gray-700"
                          id=":r1u7:"
                          role="tooltip"
                          style={{"position": "absolute", "top": "499px", "left": "60px"}}
                        >
                          <div className="relative z-20">
                            <span
                              className="px-3 flex-1 whitespace-nowrap"
                              data-testid="flowbite-sidebar-item-content"
                              id="flowbite-sidebar-item-:r2a:"
                            >
                              Components
                            </span>
                          </div>
                          <div
                            className="absolute z-10 h-2 w-2 rotate-45 bg-gray-900 dark:bg-gray-700"
                            data-testid="flowbite-tooltip-arrow"
                            style={{"left": "-4px", "top": "14px"}}
                          >
                            &nbsp;
                          </div>
                        </div>
                      </>
                    )}
                  </li>
                  <li>
                    {isSidebarOpen ? (
                      <a
                        aria-labelledby="flowbite-sidebar-item-:rv:"
                        className="flex items-center justify-center rounded-lg p-2 text-base font-medium text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700"
                        href="https://github.com/themesberg/flowbite-react/issues"
                      >
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
                        <span
                          className="px-3 flex-1 whitespace-nowrap"
                          data-testid="flowbite-sidebar-item-content"
                          id="flowbite-sidebar-item-:rv:"
                        >
                          Help
                        </span>
                      </a>
                    ) : (
                      <>
                        <div
                          className="w-fit"
                          data-testid="flowbite-tooltip-target"
                        >
                          <a
                            aria-labelledby="flowbite-sidebar-item-:r2d:"
                            className="flex items-center justify-center rounded-lg p-2 text-base font-medium text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700"
                            href="https://github.com/themesberg/flowbite-react/issues"
                          >
                            <svg
                              stroke="currentColor"
                              fill="currentColor"
                              stroke-width="0"
                              viewBox="0 0 20 20"
                              aria-hidden="true"
                              className="h-6 w-6 flex-shrink-0 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
                              data-testid="flowbite-sidebar-item-icon"
                              height="1em"
                              width="1em"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path
                                fill-rule="evenodd"
                                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                                clip-rule="evenodd"
                              ></path>
                            </svg>
                          </a>
                        </div>
                        <div
                          data-testid="flowbite-tooltip"
                          tabIndex="-1"
                          className="absolute inline-block z-10 rounded-lg py-2 px-3 text-sm font-medium shadow-sm transition-opacity duration-300 invisible opacity-0 bg-gray-900 text-white dark:bg-gray-700"
                          id=":r1u9:"
                          role="tooltip"
                          style={{"position": "absolute", "top": "547px", "left": "60px"}}
                        >
                          <div className="relative z-20">
                            <span
                              className="px-3 flex-1 whitespace-nowrap"
                              data-testid="flowbite-sidebar-item-content"
                              id="flowbite-sidebar-item-:r2d:"
                            >
                              Help
                            </span>
                          </div>
                          <div
                            className="absolute z-10 h-2 w-2 rotate-45 bg-gray-900 dark:bg-gray-700"
                            data-testid="flowbite-tooltip-arrow"
                            style={{"left": "-4px", "top": "14px"}}
                          >
                            &nbsp;
                          </div>
                        </div>
                      </>
                    )}
                  </li>
                </ul>
              </div>
            </div>
            <div className="flex items-center justify-center gap-x-5">
              <button className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700">
                <span className="sr-only">Tweaks</span>
                <svg
                  stroke="currentColor"
                  fill="currentColor"
                  strokeWidth="0"
                  viewBox="0 0 20 20"
                  className="text-2xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white "
                  height="1em"
                  width="1em"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M5 4a1 1 0 00-2 0v7.268a2 2 0 000 3.464V16a1 1 0 102 0v-1.268a2 2 0 000-3.464V4zM11 4a1 1 0 10-2 0v1.268a2 2 0 000 3.464V16a1 1 0 102 0V8.732a2 2 0 000-3.464V4zM16 3a1 1 0 011 1v7.268a2 2 0 010 3.464V16a1 1 0 11-2 0v-1.268a2 2 0 010-3.464V4a1 1 0 011-1z"></path>
                </svg>
              </button>
              <div>
                <div className="w-fit" data-testid="flowbite-tooltip-target">
                  <a
                    href="/users/settings"
                    className="inline-flex cursor-pointer justify-center rounded p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-white"
                  >
                    <span className="sr-only">Settings page</span>
                    <svg
                      stroke="currentColor"
                      fill="currentColor"
                      strokeWidth="0"
                      viewBox="0 0 20 20"
                      className="text-2xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                      height="1em"
                      width="1em"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fillRule="evenodd"
                        d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                        clipRule="evenodd"
                      ></path>
                    </svg>
                  </a>
                </div>
                <div
                  data-testid="flowbite-tooltip"
                  tabIndex="-1"
                  className="absolute inline-block z-10 rounded-lg py-2 px-3 text-sm font-medium shadow-sm transition-opacity duration-300 invisible opacity-0 bg-gray-900 text-white dark:bg-gray-700"
                  id=":r10:"
                  role="tooltip"
                  style={{
                    position: 'absolute',
                    top: '893px',
                    left: '63.8515px',
                  }}
                >
                  <div className="relative z-20">Settings page</div>
                  <div
                    className="absolute z-10 h-2 w-2 rotate-45 bg-gray-900 dark:bg-gray-700"
                    data-testid="flowbite-tooltip-arrow"
                    style={{ bottom: '-4px', left: '54px' }}
                  >
                    &nbsp;
                  </div>
                </div>
              </div>
              <div>
                <div
                  className="w-fit dark:text-white"
                  data-testid="flowbite-tooltip-target"
                >
                  <button className="flex items-center">
                    <span className="inline-flex cursor-pointer justify-center rounded p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-white">
                      <span className="sr-only">Current language</span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        xmlnsXlink="http://www.w3.org/1999/xlink"
                        viewBox="0 0 3900 3900"
                        className="h-5 w-5 rounded-full"
                      >
                        <path fill="#b22234" d="M0 0h7410v3900H0z"></path>
                        <path
                          d="M0 450h7410m0 600H0m0 600h7410m0 600H0m0 600h7410m0 600H0"
                          stroke="#fff"
                          strokeWidth="300"
                        ></path>
                        <path fill="#3c3b6e" d="M0 0h2964v2100H0z"></path>
                        <g fill="#fff">
                          <g id="d">
                            <g id="c">
                              <g id="e">
                                <g id="b">
                                  <path
                                    id="a"
                                    d="M247 90l70.534 217.082-184.66-134.164h228.253L176.466 307.082z"
                                  ></path>
                                  <use xlinkHref="#a" y="420"></use>
                                  <use xlinkHref="#a" y="840"></use>
                                  <use xlinkHref="#a" y="1260"></use>
                                </g>
                                <use xlinkHref="#a" y="1680"></use>
                              </g>
                              <use xlinkHref="#b" x="247" y="210"></use>
                            </g>
                            <use xlinkHref="#c" x="494"></use>
                          </g>
                          <use xlinkHref="#d" x="988"></use>
                          <use xlinkHref="#c" x="1976"></use>
                          <use xlinkHref="#e" x="2470"></use>
                        </g>
                      </svg>
                    </span>
                  </button>
                </div>
                <div
                  data-testid="flowbite-tooltip"
                  tabIndex="-1"
                  className="z-10 w-fit rounded-xl divide-y divide-gray-100 shadow transition-opacity duration-100 invisible opacity-0 border border-gray-200 bg-white text-gray-900 dark:border-none dark:bg-gray-700 dark:text-white"
                  id=":r12:"
                  role="tooltip"
                  style={{ position: 'absolute', top: '765px', left: '162px' }}
                >
                  <div className="rounded-xl text-sm text-gray-700 dark:text-gray-200">
                    <ul className="">
                      <ul className="py-1" role="none">
                        <li>
                          <a
                            href="#"
                            className="block py-2 px-4 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-600 dark:hover:text-white"
                          >
                            <div className="inline-flex items-center">
                              <svg
                                className="mr-2 h-4 w-4 rounded-full"
                                xmlns="http://www.w3.org/2000/svg"
                                id="flag-icon-css-us"
                                viewBox="0 0 512 512"
                              >
                                <g fillRule="evenodd">
                                  <g strokeWidth="1pt">
                                    <path
                                      fill="#bd3d44"
                                      d="M0 0h247v10H0zm0 20h247v10H0zm0 20h247v10H0zm0 20h247v10H0zm0 20h247v10H0zm0 20h247v10H0zm0 20h247v10H0z"
                                      transform="scale(3.9385)"
                                    ></path>
                                    <path
                                      fill="#fff"
                                      d="M0 10h247v10H0zm0 20h247v10H0zm0 20h247v10H0zm0 20h247v10H0zm0 20h247v10H0zm0 20h247v10H0z"
                                      transform="scale(3.9385)"
                                    ></path>
                                  </g>
                                  <path
                                    fill="#192f5d"
                                    d="M0 0h98.8v70H0z"
                                    transform="scale(3.9385)"
                                  ></path>
                                  <path
                                    fill="#fff"
                                    d="M8.2 3l1 2.8H12L9.7 7.5l.9 2.7-2.4-1.7L6 10.2l.9-2.7-2.4-1.7h3zm16.5 0l.9 2.8h2.9l-2.4 1.7 1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7h2.9zm16.5 0l.9 2.8H45l-2.4 1.7 1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7h2.9zm16.4 0l1 2.8h2.8l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h3zm16.5 0l.9 2.8h2.9l-2.4 1.7 1 2.7L74 8.5l-2.3 1.7.9-2.7-2.4-1.7h2.9zm16.5 0l.9 2.8h2.9L92 7.5l1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7h2.9zm-74.1 7l.9 2.8h2.9l-2.4 1.7 1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7h2.9zm16.4 0l1 2.8h2.8l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h3zm16.5 0l.9 2.8h2.9l-2.4 1.7 1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7h2.9zm16.5 0l.9 2.8h2.9l-2.4 1.7 1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7H65zm16.4 0l1 2.8H86l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h3zm-74 7l.8 2.8h3l-2.4 1.7.9 2.7-2.4-1.7L6 24.2l.9-2.7-2.4-1.7h3zm16.4 0l.9 2.8h2.9l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h2.9zm16.5 0l.9 2.8H45l-2.4 1.7 1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7h2.9zm16.4 0l1 2.8h2.8l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h3zm16.5 0l.9 2.8h2.9l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h2.9zm16.5 0l.9 2.8h2.9L92 21.5l1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7h2.9zm-74.1 7l.9 2.8h2.9l-2.4 1.7 1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7h2.9zm16.4 0l1 2.8h2.8l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h3zm16.5 0l.9 2.8h2.9l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h2.9zm16.5 0l.9 2.8h2.9l-2.4 1.7 1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7H65zm16.4 0l1 2.8H86l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h3zm-74 7l.8 2.8h3l-2.4 1.7.9 2.7-2.4-1.7L6 38.2l.9-2.7-2.4-1.7h3zm16.4 0l.9 2.8h2.9l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h2.9zm16.5 0l.9 2.8H45l-2.4 1.7 1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7h2.9zm16.4 0l1 2.8h2.8l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h3zm16.5 0l.9 2.8h2.9l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h2.9zm16.5 0l.9 2.8h2.9L92 35.5l1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7h2.9zm-74.1 7l.9 2.8h2.9l-2.4 1.7 1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7h2.9zm16.4 0l1 2.8h2.8l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h3zm16.5 0l.9 2.8h2.9l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h2.9zm16.5 0l.9 2.8h2.9l-2.4 1.7 1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7H65zm16.4 0l1 2.8H86l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h3zm-74 7l.8 2.8h3l-2.4 1.7.9 2.7-2.4-1.7L6 52.2l.9-2.7-2.4-1.7h3zm16.4 0l.9 2.8h2.9l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h2.9zm16.5 0l.9 2.8H45l-2.4 1.7 1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7h2.9zm16.4 0l1 2.8h2.8l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h3zm16.5 0l.9 2.8h2.9l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h2.9zm16.5 0l.9 2.8h2.9L92 49.5l1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7h2.9zm-74.1 7l.9 2.8h2.9l-2.4 1.7 1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7h2.9zm16.4 0l1 2.8h2.8l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h3zm16.5 0l.9 2.8h2.9l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h2.9zm16.5 0l.9 2.8h2.9l-2.4 1.7 1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7H65zm16.4 0l1 2.8H86l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h3zm-74 7l.8 2.8h3l-2.4 1.7.9 2.7-2.4-1.7L6 66.2l.9-2.7-2.4-1.7h3zm16.4 0l.9 2.8h2.9l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h2.9zm16.5 0l.9 2.8H45l-2.4 1.7 1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7h2.9zm16.4 0l1 2.8h2.8l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h3zm16.5 0l.9 2.8h2.9l-2.3 1.7.9 2.7-2.4-1.7-2.3 1.7.9-2.7-2.4-1.7h2.9zm16.5 0l.9 2.8h2.9L92 63.5l1 2.7-2.4-1.7-2.4 1.7 1-2.7-2.4-1.7h2.9z"
                                    transform="scale(3.9385)"
                                  ></path>
                                </g>
                              </svg>
                              <span className="whitespace-nowrap">
                                English (US)
                              </span>
                            </div>
                          </a>
                        </li>
                        <li>
                          <a
                            href="#"
                            className="block py-2 px-4 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-600 dark:hover:text-white"
                          >
                            <div className="inline-flex items-center">
                              <svg
                                className="mr-2 h-4 w-4 rounded-full"
                                xmlns="http://www.w3.org/2000/svg"
                                id="flag-icon-css-de"
                                viewBox="0 0 512 512"
                              >
                                <path
                                  fill="#ffce00"
                                  d="M0 341.3h512V512H0z"
                                ></path>
                                <path d="M0 0h512v170.7H0z"></path>
                                <path
                                  fill="#d00"
                                  d="M0 170.7h512v170.6H0z"
                                ></path>
                              </svg>
                              Deutsch
                            </div>
                          </a>
                        </li>
                        <li>
                          <a
                            href="#"
                            className="block py-2 px-4 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-600 dark:hover:text-white"
                          >
                            <div className="inline-flex items-center">
                              <svg
                                className="mr-2 h-4 w-4 rounded-full"
                                xmlns="http://www.w3.org/2000/svg"
                                id="flag-icon-css-it"
                                viewBox="0 0 512 512"
                              >
                                <g fillRule="evenodd" strokeWidth="1pt">
                                  <path fill="#fff" d="M0 0h512v512H0z"></path>
                                  <path
                                    fill="#009246"
                                    d="M0 0h170.7v512H0z"
                                  ></path>
                                  <path
                                    fill="#ce2b37"
                                    d="M341.3 0H512v512H341.3z"
                                  ></path>
                                </g>
                              </svg>
                              Italiano
                            </div>
                          </a>
                        </li>
                        <li>
                          <a
                            href="#"
                            className="block py-2 px-4 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-600 dark:hover:text-white"
                          >
                            <div className="inline-flex items-center">
                              <svg
                                className="mr-2 h-4 w-4 rounded-full"
                                xmlns="http://www.w3.org/2000/svg"
                                xmlnsXlink="http://www.w3.org/1999/xlink"
                                id="flag-icon-css-cn"
                                viewBox="0 0 512 512"
                              >
                                <defs>
                                  <path
                                    id="a"
                                    fill="#ffde00"
                                    d="M1-.3L-.7.8 0-1 .6.8-1-.3z"
                                  ></path>
                                </defs>
                                <path fill="#de2910" d="M0 0h512v512H0z"></path>
                                <use
                                  width="30"
                                  height="20"
                                  transform="matrix(76.8 0 0 76.8 128 128)"
                                  xlinkHref="#a"
                                ></use>
                                <use
                                  width="30"
                                  height="20"
                                  transform="rotate(-121 142.6 -47) scale(25.5827)"
                                  xlinkHref="#a"
                                ></use>
                                <use
                                  width="30"
                                  height="20"
                                  transform="rotate(-98.1 198 -82) scale(25.6)"
                                  xlinkHref="#a"
                                ></use>
                                <use
                                  width="30"
                                  height="20"
                                  transform="rotate(-74 272.4 -114) scale(25.6137)"
                                  xlinkHref="#a"
                                ></use>
                                <use
                                  width="30"
                                  height="20"
                                  transform="matrix(16 -19.968 19.968 16 256 230.4)"
                                  xlinkHref="#a"
                                ></use>
                              </svg>
                              <span className="whitespace-nowrap">
                                中文 (繁體)
                              </span>
                            </div>
                          </a>
                        </li>
                      </ul>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};

export { Sidebar };
