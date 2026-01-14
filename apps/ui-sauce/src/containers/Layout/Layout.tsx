import React from 'react';
import { Outlet } from 'react-router';

// import { Footer } from './Footer';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';

interface LayoutProps {
  children?: React.ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);

  const toggleSidebar = React.useCallback(() => {
    setIsSidebarOpen((prevIsSidebarOpen) => !prevIsSidebarOpen);
  }, []);

  return (
    <div>
      <Navbar onBtnToggleSidebarClick={toggleSidebar} />

      <div className="flex items-start pt-16">
        <Sidebar isSidebarOpen={isSidebarOpen} />
        <main
          className={
            isSidebarOpen
              ? 'overflow-y-auto relative w-full h-full bg-gray-50 dark:bg-gray-900 lg:ml-64'
              : 'overflow-y-auto relative w-full h-full bg-gray-50 dark:bg-gray-900 lg:ml-16'
          }
        >
          <div className="px-4 pt-6">
            <Outlet />
            {/* {children} */}
          </div>

          {/* <Footer /> */}
        </main>
      </div>
    </div>
  );
};

export { Layout };
