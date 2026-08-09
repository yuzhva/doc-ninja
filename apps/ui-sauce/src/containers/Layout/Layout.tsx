import React from 'react';
import { Outlet } from 'react-router';

// import { Footer } from './Footer';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';
import { WelcomeModal } from './WelcomeModal';

interface LayoutProps {
  children?: React.ReactNode;
}

// `min-h-0` lets pages that own the full viewport height (see `lg:h-screen`
// below) hand a bounded height down to their own scroll containers instead of
// growing the document and scrolling the whole page.
const MAIN_CLASS_NAME =
  'overflow-y-auto relative w-full h-full min-h-0 bg-gray-50 dark:bg-gray-900';

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

      {/* From `lg` up the shell is pinned to the viewport (100vh minus the
          fixed navbar) so pages can scroll their own sections. Below `lg` it
          keeps growing with its content and the document scrolls as before. */}
      <div className="flex items-start pt-16 lg:h-screen lg:items-stretch">
        {isSidebarVisible && <Sidebar isSidebarOpen={isSidebarOpen} />}
        <main
          className={
            isSidebarVisible
              ? isSidebarOpen
                ? `${MAIN_CLASS_NAME} lg:ml-64`
                : `${MAIN_CLASS_NAME} lg:ml-16`
              : MAIN_CLASS_NAME
          }
        >
          <div className="px-4 pt-6 lg:h-full lg:pb-6">
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
