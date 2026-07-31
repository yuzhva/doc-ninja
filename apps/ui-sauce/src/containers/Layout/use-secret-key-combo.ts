import { useEffect, useRef } from 'react';

// Fires once when every key in `keys` is held down at the same time, and
// re-arms only after all of them have been released — so holding the combo
// doesn't repeat-fire, and keys can be pressed in any order. Listeners are
// only attached while `enabled` is true, e.g. only while the settings modal
// that contains the secret is actually open.
const useSecretKeyCombo = (
  keys: string[],
  onTrigger: () => void,
  enabled: boolean,
) => {
  const pressedKeysRef = useRef(new Set<string>());
  const hasTriggeredRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const targetKeys = new Set(keys);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!targetKeys.has(event.key)) return;

      pressedKeysRef.current.add(event.key);

      const isComboActive = keys.every((key) =>
        pressedKeysRef.current.has(key),
      );
      if (isComboActive && !hasTriggeredRef.current) {
        hasTriggeredRef.current = true;
        onTrigger();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!targetKeys.has(event.key)) return;

      pressedKeysRef.current.delete(event.key);
      if (pressedKeysRef.current.size === 0) {
        hasTriggeredRef.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      pressedKeysRef.current.clear();
      hasTriggeredRef.current = false;
    };
  }, [keys, onTrigger, enabled]);
};

export { useSecretKeyCombo };
