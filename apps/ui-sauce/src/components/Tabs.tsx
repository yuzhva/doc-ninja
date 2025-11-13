import React, { useState } from 'react';

// This component is a data container for the tab's content.
// It doesn't render anything itself; the parent `Tabs` component handles rendering.
const TabsItem = ({
  children,
}: {
  children: React.ReactNode;
  title: string;
}) => {
  return <>{children}</>;
};

const Tabs = ({ children }: { children: React.ReactNode }) => {
  const [activeTab, setActiveTab] = useState(0);

  // Filter out any invalid children to get an array of Tab.Item components
  const tabs = React.Children.toArray(children).filter(
    (child) => React.isValidElement(child) && child.type === TabsItem,
  );

  return (
    <>
      <div className="text-sm font-medium text-center text-gray-500 border-b border-gray-200 dark:text-gray-400 dark:border-gray-700">
        <ul className="flex flex-wrap -mb-px">
          {tabs.map((tab, index) => {
            const { title, disabled } = tab.props;
            const isActive = index === activeTab;

            // Define CSS classes based on the tab's state
            const activeClasses =
              'text-blue-600 border-b-2 border-blue-600 active dark:text-blue-500 dark:border-blue-500';
            const inactiveClasses =
              'border-transparent hover:text-gray-600 hover:border-gray-300 dark:hover:text-gray-300';
            const disabledClasses =
              'text-gray-400 cursor-not-allowed dark:text-gray-500';

            return (
              <li key={title} className="me-2">
                <button
                  onClick={() => !disabled && setActiveTab(index)}
                  className={`inline-block p-4 rounded-t-lg cursor-pointer ${
                    disabled
                      ? disabledClasses
                      : isActive
                        ? activeClasses
                        : inactiveClasses
                  }`}
                  disabled={disabled}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {title}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="p-4">
        {/* Render the content of the currently active tab */}
        {tabs[activeTab]}
      </div>
    </>
  );
};

Tabs.Item = TabsItem;

export { Tabs };
