import { useCallback, useEffect, useRef, useState } from 'react';

// Hook to detect user's reduced motion preference
export function useReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return prefersReducedMotion;
}

// Hook for throttling rapid updates (useful for websocket data)
export function useThrottle<T>(value: T, delay: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const lastExecuted = useRef<number>(Date.now());

  useEffect(() => {
    const now = Date.now();
    if (now - lastExecuted.current >= delay) {
      setThrottledValue(value);
      lastExecuted.current = now;
    } else {
      const timerId = setTimeout(() => {
        setThrottledValue(value);
        lastExecuted.current = Date.now();
      }, delay - (now - lastExecuted.current));

      return () => clearTimeout(timerId);
    }
  }, [value, delay]);

  return throttledValue;
}

// Hook for debouncing rapid updates (useful for search inputs)
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Hook for lazy loading with intersection observer
export function useLazyLoad(threshold = 0.1) {
  const [isIntersecting, setIsIntersecting] = useState(false);
  const [hasIntersected, setHasIntersected] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsIntersecting(entry.isIntersecting);
        if (entry.isIntersecting && !hasIntersected) {
          setHasIntersected(true);
        }
      },
      { threshold }
    );

    observer.observe(element);

    return () => {
      observer.unobserve(element);
    };
  }, [threshold, hasIntersected]);

  return { ref, isIntersecting, hasIntersected };
}

// Hook for batching state updates
export function useBatchedState<T>(initialState: T) {
  const [state, setState] = useState(initialState);
  const batchedUpdates = useRef<Partial<T>[]>([]);
  const timeoutRef = useRef<NodeJS.Timeout>();

  const batchUpdate = useCallback((update: Partial<T>) => {
    batchedUpdates.current.push(update);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setState(prevState => {
        let newState = { ...prevState };
        batchedUpdates.current.forEach(update => {
          newState = { ...newState, ...update };
        });
        batchedUpdates.current = [];
        return newState;
      });
    }, 16); // ~60fps
  }, []);

  const immediateUpdate = useCallback((update: Partial<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    batchedUpdates.current = [];
    setState(prevState => ({ ...prevState, ...update }));
  }, []);

  return [state, batchUpdate, immediateUpdate] as const;
}

// Hook for memoizing expensive computations
export function useMemoizedValue<T>(
  factory: () => T,
  deps: React.DependencyList,
  compare?: (prev: T, next: T) => boolean
): T {
  const ref = useRef<{ value: T; deps: React.DependencyList }>();

  if (
    !ref.current ||
    ref.current.deps.length !== deps.length ||
    ref.current.deps.some((dep, index) => dep !== deps[index])
  ) {
    const newValue = factory();
    if (!ref.current || !compare || !compare(ref.current.value, newValue)) {
      ref.current = { value: newValue, deps };
    }
  }

  return ref.current.value;
}

// Hook for centralized polling with visibility detection
export function usePolling(
  callback: () => void | Promise<void>,
  interval: number,
  enabled: boolean = true
) {
  const callbackRef = useRef(callback);
  const intervalRef = useRef<NodeJS.Timeout>();
  const [isVisible, setIsVisible] = useState(!document.hidden);

  // Update callback ref when callback changes
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Handle visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Manage polling
  useEffect(() => {
    if (enabled && isVisible) {
      // Execute immediately
      callbackRef.current();

      // Set up interval
      intervalRef.current = setInterval(() => {
        callbackRef.current();
      }, interval);
    } else {
      // Clear interval when disabled or not visible
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = undefined;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [enabled, isVisible, interval]);

  // Manual trigger
  const trigger = useCallback(() => {
    callbackRef.current();
  }, []);

  return { trigger, isPolling: enabled && isVisible };
}
