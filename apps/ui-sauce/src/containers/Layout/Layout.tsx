import React from 'react';
import { Outlet } from 'react-router';

// import { Footer } from './Footer';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';
import { WelcomeModal } from './WelcomeModal';

interface LayoutProps {
  children?: React.ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  const [isSidebarVisible, setIsSidebarVisible] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('docNinja_isSidebarAvailable') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebar = React.useCallback(() => {
    setIsSidebarOpen((prevIsSidebarOpen) => !prevIsSidebarOpen);
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem(
        'docNinja_isSidebarAvailable',
        String(isSidebarVisible),
      );
    } catch (e) {
      console.warn('Failed to save sidebar visibility to storage', e);
    }
  }, [isSidebarVisible]);

  return (
    <div>
      <WelcomeModal />

      <Navbar
        onBtnToggleSidebarClick={toggleSidebar}
        isSidebarVisible={isSidebarVisible}
        onSidebarVisibleChange={setIsSidebarVisible}
      />

      <div className="flex items-start pt-16">
        {isSidebarVisible && <Sidebar isSidebarOpen={isSidebarOpen} />}
        <main
          className={
            isSidebarVisible
              ? isSidebarOpen
                ? 'overflow-y-auto relative w-full h-full bg-gray-50 dark:bg-gray-900 lg:ml-64'
                : 'overflow-y-auto relative w-full h-full bg-gray-50 dark:bg-gray-900 lg:ml-16'
              : 'overflow-y-auto relative w-full h-full bg-gray-50 dark:bg-gray-900'
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
