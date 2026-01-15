import React from 'react';
import { Link } from 'react-router';

const THEME_CURRENT_MODE__DEFAULT = 'dark';

interface NavbarProps {
  onBtnToggleSidebarClick: () => void;
}

const Navbar = ({ onBtnToggleSidebarClick }: NavbarProps) => {
  const [themeCurrentMode, setThemeCurrentMode] = React.useState(
    THEME_CURRENT_MODE__DEFAULT,
  );

  const handleThemeModeSwitch = React.useCallback(() => {
    setThemeCurrentMode((prevMode) => {
      const nextMode = prevMode === 'dark' ? 'light' : 'dark';

      window.document.documentElement.classList.add(nextMode);
      window.document.documentElement.classList.remove(prevMode);

      return nextMode;
    });
  }, []);

  React.useEffect(() => {
    window.document.documentElement.classList.add(themeCurrentMode);
    return () => {
      window.document.documentElement.classList.remove(themeCurrentMode);
    };
  }, []);

  return (
    <nav className="fixed z-30 w-full bg-white border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700">
      <div className="mx-auto flex flex-wrap items-center justify-between">
        <div className="w-full p-3 lg:px-5 lg:pl-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <button
                className="mr-3 cursor-pointer rounded p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white lg:inline"
                onClick={onBtnToggleSidebarClick}
              >
                <span className="sr-only">Toggle sidebar</span>
                <svg
                  stroke="currentColor"
                  fill="currentColor"
                  strokeWidth="0"
                  viewBox="0 0 20 20"
                  className="h-6 w-6"
                  height="1em"
                  width="1em"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                    clipRule="evenodd"
                  ></path>
                </svg>
              </button>
              <Link className="flex items-center" to="/">
                <img
                  alt=""
                  src="/static-assets/images/doc-ninja--logo.png"
                  className="mr-3 h-6 sm:h-8"
                />
                <span className="self-center whitespace-nowrap text-2xl font-semibold dark:text-white">
                  DocNinja
                </span>
              </Link>
              {/*
              <form className="ml-16 hidden md:block">
                <label
                  className="text-sm font-medium text-gray-900 dark:text-gray-300 sr-only"
                  htmlFor="search"
                >
                  Search
                </label>
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
                      id="search"
                      name="search"
                      placeholder="Search"
                      required
                      size={32}
                      type="search"
                    />
                  </div>
                </div>
              </form>
              */}
            </div>

            <div className="flex items-center lg:gap-3">
              <div className="flex items-center">
                {/*
                <button className="cursor-pointer rounded p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:bg-gray-100 focus:ring-2 focus:ring-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white dark:focus:bg-gray-700 dark:focus:ring-gray-700 lg:hidden">
                  <span className="sr-only">Search</span>
                  <svg
                    stroke="currentColor"
                    fill="currentColor"
                    strokeWidth="0"
                    viewBox="0 0 20 20"
                    className="h-6 w-6"
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
                </button>
                <div
                  className="w-fit dark:text-white"
                  data-testid="flowbite-tooltip-target"
                >
                  <button className="flex items-center">
                    <span className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700">
                      <span className="sr-only">Notifications</span>
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
                        <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z"></path>
                      </svg>
                    </span>
                  </button>
                </div>
                <div
                  data-testid="flowbite-tooltip"
                  tabIndex="-1"
                  className="z-10 w-fit rounded-xl divide-y divide-gray-100 shadow transition-opacity duration-100 invisible opacity-0 border border-gray-200 bg-white text-gray-900 dark:border-none dark:bg-gray-700 dark:text-white"
                  id=":r0:"
                  role="tooltip"
                  style={{
                    position: 'absolute',
                    top: '61px',
                    left: '908.562px',
                  }}
                >
                  <div className="rounded-xl text-sm text-gray-700 dark:text-gray-200">
                    <ul className="">
                      <div className="max-w-[24rem]">
                        <div className="block rounded-t-xl bg-gray-50 py-2 px-4 text-center text-base font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-400">
                          Notifications
                        </div>
                        <div>
                          <a
                            href="#"
                            className="flex border-y py-3 px-4 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-600"
                          >
                            <div className="shrink-0">
                              <img
                                alt=""
                                src="../images/users/bonnie-green.png"
                                className="h-11 w-11 rounded-full"
                              />
                              <div className="absolute -mt-5 ml-6 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-primary-700 dark:border-gray-700">
                                <svg
                                  className="h-3 w-3 text-white"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path d="M8.707 7.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l2-2a1 1 0 00-1.414-1.414L11 7.586V3a1 1 0 10-2 0v4.586l-.293-.293z"></path>
                                  <path d="M3 5a2 2 0 012-2h1a1 1 0 010 2H5v7h2l1 2h4l1-2h2V5h-1a1 1 0 110-2h1a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"></path>
                                </svg>
                              </div>
                            </div>
                            <div className="w-full pl-3">
                              <div className="mb-1.5 text-sm font-normal text-gray-500 dark:text-gray-400">
                                New message from&nbsp;
                                <span className="font-semibold text-gray-900 dark:text-white">
                                  Bonnie Green
                                </span>
                                : "Hey, what's up? All set for the
                                presentation?"
                              </div>
                              <div className="text-xs font-medium text-primary-700 dark:text-primary-400">
                                a few moments ago
                              </div>
                            </div>
                          </a>
                          <a
                            href="#"
                            className="flex border-b py-3 px-4 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-600"
                          >
                            <div className="shrink-0">
                              <img
                                alt=""
                                src="../images/users/jese-leos.png"
                                className="h-11 w-11 rounded-full"
                              />
                              <div className="absolute -mt-5 ml-6 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-gray-900 dark:border-gray-700">
                                <svg
                                  className="h-3 w-3 text-white"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z"></path>
                                </svg>
                              </div>
                            </div>
                            <div className="w-full pl-3">
                              <div className="mb-1.5 text-sm font-normal text-gray-500 dark:text-gray-400">
                                <span className="font-semibold text-gray-900 dark:text-white">
                                  Jese Leos
                                </span>
                                &nbsp;and&nbsp;
                                <span className="font-medium text-gray-900 dark:text-white">
                                  5 others
                                </span>
                                &nbsp;started following you.
                              </div>
                              <div className="text-xs font-medium text-primary-700 dark:text-primary-400">
                                10 minutes ago
                              </div>
                            </div>
                          </a>
                          <a
                            href="#"
                            className="flex border-b py-3 px-4 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-600"
                          >
                            <div className="shrink-0">
                              <img
                                alt=""
                                src="../images/users/joseph-mcfall.png"
                                className="h-11 w-11 rounded-full"
                              />
                              <div className="absolute -mt-5 ml-6 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-red-600 dark:border-gray-700">
                                <svg
                                  className="h-3 w-3 text-white"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z"
                                    clipRule="evenodd"
                                  ></path>
                                </svg>
                              </div>
                            </div>
                            <div className="w-full pl-3">
                              <div className="mb-1.5 text-sm font-normal text-gray-500 dark:text-gray-400">
                                <span className="font-semibold text-gray-900 dark:text-white">
                                  Joseph Mcfall
                                </span>
                                &nbsp;and&nbsp;
                                <span className="font-medium text-gray-900 dark:text-white">
                                  141 others
                                </span>
                                &nbsp;love your story. See it and view more
                                stories.
                              </div>
                              <div className="text-xs font-medium text-primary-700 dark:text-primary-400">
                                44 minutes ago
                              </div>
                            </div>
                          </a>
                          <a
                            href="#"
                            className="flex border-b py-3 px-4 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-600"
                          >
                            <div className="shrink-0">
                              <img
                                alt=""
                                src="../images/users/leslie-livingston.png"
                                className="h-11 w-11 rounded-full"
                              />
                              <div className="absolute -mt-5 ml-6 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-green-400 dark:border-gray-700">
                                <svg
                                  className="h-3 w-3 text-white"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M18 13V5a2 2 0 00-2-2H4a2 2 0 00-2 2v8a2 2 0 002 2h3l3 3 3-3h3a2 2 0 002-2zM5 7a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zm1 3a1 1 0 100 2h3a1 1 0 100-2H6z"
                                    clipRule="evenodd"
                                  ></path>
                                </svg>
                              </div>
                            </div>
                            <div className="w-full pl-3">
                              <div className="mb-1.5 text-sm font-normal text-gray-500 dark:text-gray-400">
                                <span className="font-semibold text-gray-900 dark:text-white">
                                  Leslie Livingston
                                </span>
                                &nbsp;mentioned you in a comment:&nbsp;
                                <span className="font-medium text-primary-700 dark:text-primary-500">
                                  @bonnie.green
                                </span>
                                &nbsp;what do you say?
                              </div>
                              <div className="text-xs font-medium text-primary-700 dark:text-primary-400">
                                1 hour ago
                              </div>
                            </div>
                          </a>
                          <a
                            href="#"
                            className="flex py-3 px-4 hover:bg-gray-100 dark:hover:bg-gray-600"
                          >
                            <div className="shrink-0">
                              <img
                                alt=""
                                src="../images/users/robert-brown.png"
                                className="h-11 w-11 rounded-full"
                              />
                              <div className="absolute -mt-5 ml-6 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-purple-500 dark:border-gray-700">
                                <svg
                                  className="h-3 w-3 text-white"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path d="M2 6a2 2 0 002-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z"></path>
                                </svg>
                              </div>
                            </div>
                            <div className="w-full pl-3">
                              <div className="mb-1.5 text-sm font-normal text-gray-500 dark:text-gray-400">
                                <span className="font-semibold text-gray-900 dark:text-white">
                                  Robert Brown
                                </span>
                                &nbsp;posted a new video: Glassmorphism - learn
                                how to implement the new design trend.
                              </div>
                              <div className="text-xs font-medium text-primary-700 dark:text-primary-400">
                                3 hours ago
                              </div>
                            </div>
                          </a>
                        </div>
                        <a
                          href="#"
                          className="block rounded-b-xl bg-gray-50 py-2 text-center text-base font-normal text-gray-900 hover:bg-gray-100 dark:bg-gray-700 dark:text-white dark:hover:underline"
                        >
                          <div className="inline-flex items-center gap-x-2">
                            <svg
                              stroke="currentColor"
                              fill="currentColor"
                              strokeWidth="0"
                              viewBox="0 0 20 20"
                              className="h-6 w-6"
                              height="1em"
                              width="1em"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"></path>
                              <path
                                fillRule="evenodd"
                                d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                                clipRule="evenodd"
                              ></path>
                            </svg>
                            <span>View all</span>
                          </div>
                        </a>
                      </div>
                    </ul>
                  </div>
                </div>
                <div
                  className="w-fit dark:text-white"
                  data-testid="flowbite-tooltip-target"
                >
                  <button className="flex items-center">
                    <span className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700">
                      <span className="sr-only">Apps</span>
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
                        <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path>
                      </svg>
                    </span>
                  </button>
                </div>
                <div
                  data-testid="flowbite-tooltip"
                  tabIndex="-1"
                  className="z-10 w-fit rounded-xl divide-y divide-gray-100 shadow transition-opacity duration-100 invisible opacity-0 border border-gray-200 bg-white text-gray-900 dark:border-none dark:bg-gray-700 dark:text-white"
                  id=":r2:"
                  role="tooltip"
                  style={{
                    position: 'absolute',
                    top: '61px',
                    left: '1019px',
                  }}
                >
                  <div className="rounded-xl text-sm text-gray-700 dark:text-gray-200">
                    <ul className="">
                      <div className="block rounded-t-lg border-b bg-gray-50 py-2 px-4 text-center text-base font-medium text-gray-700 dark:border-b-gray-600 dark:bg-gray-700 dark:text-white">
                        Apps
                      </div>
                      <div className="grid grid-cols-3 gap-4 p-4">
                        <a
                          href="#"
                          className="block rounded-lg p-4 text-center hover:bg-gray-100 dark:hover:bg-gray-600"
                        >
                          <svg
                            stroke="currentColor"
                            fill="currentColor"
                            strokeWidth="0"
                            viewBox="0 0 20 20"
                            className="mx-auto mb-1 h-7 w-7 text-gray-500 dark:text-white"
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
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            Sales
                          </div>
                        </a>
                        <a
                          href="#"
                          className="block rounded-lg p-4 text-center hover:bg-gray-100 dark:hover:bg-gray-600"
                        >
                          <svg
                            stroke="currentColor"
                            fill="currentColor"
                            strokeWidth="0"
                            viewBox="0 0 20 20"
                            className="mx-auto mb-1 h-7 w-7 text-gray-500 dark:text-white"
                            height="1em"
                            width="1em"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"></path>
                          </svg>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            Users
                          </div>
                        </a>
                        <a
                          href="#"
                          className="block rounded-lg p-4 text-center hover:bg-gray-100 dark:hover:bg-gray-600"
                        >
                          <svg
                            stroke="currentColor"
                            fill="currentColor"
                            strokeWidth="0"
                            viewBox="0 0 20 20"
                            className="mx-auto mb-1 h-7 w-7 text-gray-500 dark:text-white"
                            height="1em"
                            width="1em"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              fillRule="evenodd"
                              d="M5 3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 2h10v7h-2l-1 2H8l-1-2H5V5z"
                              clipRule="evenodd"
                            ></path>
                          </svg>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            Inbox
                          </div>
                        </a>
                        <a
                          href="#"
                          className="block rounded-lg p-4 text-center hover:bg-gray-100 dark:hover:bg-gray-600"
                        >
                          <svg
                            stroke="currentColor"
                            fill="currentColor"
                            strokeWidth="0"
                            viewBox="0 0 20 20"
                            className="mx-auto mb-1 h-7 w-7 text-gray-500 dark:text-white"
                            height="1em"
                            width="1em"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              fillRule="evenodd"
                              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0010 11z"
                              clipRule="evenodd"
                            ></path>
                          </svg>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            Profile
                          </div>
                        </a>
                        <a
                          href="#"
                          className="block rounded-lg p-4 text-center hover:bg-gray-100 dark:hover:bg-gray-600"
                        >
                          <svg
                            stroke="currentColor"
                            fill="currentColor"
                            strokeWidth="0"
                            viewBox="0 0 20 20"
                            className="mx-auto mb-1 h-7 w-7 text-gray-500 dark:text-white"
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
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            Settings
                          </div>
                        </a>
                        <a
                          href="#"
                          className="block rounded-lg p-4 text-center hover:bg-gray-100 dark:hover:bg-gray-600"
                        >
                          <svg
                            stroke="currentColor"
                            fill="currentColor"
                            strokeWidth="0"
                            viewBox="0 0 20 20"
                            className="mx-auto mb-1 h-7 w-7 text-gray-500 dark:text-white"
                            height="1em"
                            width="1em"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4z"></path>
                            <path
                              fillRule="evenodd"
                              d="M3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"
                              clipRule="evenodd"
                            ></path>
                          </svg>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            Products
                          </div>
                        </a>
                        <a
                          href="#"
                          className="block rounded-lg p-4 text-center hover:bg-gray-100 dark:hover:bg-gray-600"
                        >
                          <svg
                            stroke="currentColor"
                            fill="currentColor"
                            strokeWidth="0"
                            viewBox="0 0 20 20"
                            className="mx-auto mb-1 h-7 w-7 text-gray-500 dark:text-white"
                            height="1em"
                            width="1em"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"></path>
                          </svg>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            Billing
                          </div>
                        </a>
                        <a
                          href="#"
                          className="block rounded-lg p-4 text-center hover:bg-gray-100 dark:hover:bg-gray-600"
                        >
                          <svg
                            stroke="currentColor"
                            fill="currentColor"
                            strokeWidth="0"
                            viewBox="0 0 20 20"
                            className="mx-auto mb-1 h-7 w-7 text-gray-500 dark:text-white"
                            height="1em"
                            width="1em"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              fillRule="evenodd"
                              d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z"
                              clipRule="evenodd"
                            ></path>
                          </svg>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            Logout
                          </div>
                        </a>
                      </div>
                    </ul>
                  </div>
                </div>
                */}
                <button
                  className="rounded-lg p-2.5 text-sm text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-700"
                  data-testid="dark-theme-toggle"
                  type="button"
                  aria-label="Toggle dark mode"
                  onClick={handleThemeModeSwitch}
                >
                  {themeCurrentMode === 'dark' ? (
                    <svg
                      stroke="currentColor"
                      fill="currentColor"
                      strokeWidth="0"
                      viewBox="0 0 20 20"
                      aria-label="Currently dark mode"
                      className="h-5 w-5"
                      height="1em"
                      width="1em"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                        clipRule="evenodd"
                      ></path>
                    </svg>
                  ) : (
                    <svg
                      stroke="currentColor"
                      fill="currentColor"
                      strokeWidth="0"
                      viewBox="0 0 20 20"
                      aria-label="Currently light mode"
                      className="h-5 w-5"
                      height="1em"
                      width="1em"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"></path>
                    </svg>
                  )}
                </button>
              </div>
              {/*
              <div className="hidden lg:block">
                <div
                  className="w-fit dark:text-white"
                  data-testid="flowbite-tooltip-target"
                >
                  <button className="flex items-center">
                    <span>
                      <span className="sr-only">User menu</span>
                      <div
                        className="flex justify-center items-center space-x-4"
                        data-testid="flowbite-avatar"
                      >
                        <div className="relative">
                          <img
                            alt=""
                            className="!rounded-full rounded w-8 h-8 rounded"
                            data-testid="flowbite-avatar-img"
                            src="../images/users/neil-sims.png"
                          />
                        </div>
                      </div>
                    </span>
                  </button>
                </div>
                <div
                  data-testid="flowbite-tooltip"
                  tabIndex="-1"
                  className="z-10 w-fit rounded-xl divide-y divide-gray-100 shadow transition-opacity duration-100 invisible opacity-0 border border-gray-200 bg-white text-gray-900 dark:border-none dark:bg-gray-700 dark:text-white"
                  id=":r4:"
                  role="tooltip"
                  style={{
                    position: 'absolute',
                    top: '57px',
                    left: '1093.33px',
                  }}
                >
                  <div className="rounded-xl text-sm text-gray-700 dark:text-gray-200">
                    <ul className="">
                      <div className="block py-2 px-4 text-sm text-gray-700 dark:text-gray-200">
                        <span className="block text-sm">Neil Sims</span>
                        <span className="block truncate text-sm font-medium">
                          neil.sims@flowbite.com
                        </span>
                      </div>
                      <div className="my-1 h-px bg-gray-100 dark:bg-gray-600"></div>
                      <li className="flex items-center justify-start py-2 px-4 text-sm text-gray-700 cursor-pointer hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-600 dark:hover:text-white">
                        Dashboard
                      </li>
                      <li className="flex items-center justify-start py-2 px-4 text-sm text-gray-700 cursor-pointer hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-600 dark:hover:text-white">
                        Settings
                      </li>
                      <li className="flex items-center justify-start py-2 px-4 text-sm text-gray-700 cursor-pointer hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-600 dark:hover:text-white">
                        Earnings
                      </li>
                      <div className="my-1 h-px bg-gray-100 dark:bg-gray-600"></div>
                      <li className="flex items-center justify-start py-2 px-4 text-sm text-gray-700 cursor-pointer hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-600 dark:hover:text-white">
                        Sign out
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
              */}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export { Navbar };
