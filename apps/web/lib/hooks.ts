// Custom React Hooks with TypeScript for Recruiter Radar

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppContext, DashboardState, DigestState, ClientProfileState, UIState } from './app-context';
import type { AsyncState, UseAsyncOptions, UseAsyncReturn } from './state-management-types';

// Async hook
export function useAsync<T>(
  asyncFunction: () => Promise<T>,
  options: UseAsyncOptions = {}
): UseAsyncReturn<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { immediate = true, onSuccess, onError } = options;

  const execute = useCallback(async (asyncFn: () => Promise<T> = asyncFunction) => {
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const result = await asyncFn();
      setData(result);
      onSuccess?.(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      onError?.(err as Error);
    } finally {
      setLoading(false);
    }
  }, [asyncFunction, loading, onSuccess, onError]);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (immediate) {
      execute();
    }
  }, [execute, immediate]);

  return { data, loading, error, execute, reset };
}

// Local storage hook
export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  const setValue = useCallback((value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error);
    }
  }, [key, storedValue]);

  return [storedValue, setValue];
}

// Debounce hook
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

// Intersection observer hook
export function useIntersectionObserver(
  elementRef: React.RefObject<Element | null>,
  options: IntersectionObserverInit = {}
): [boolean, IntersectionObserverEntry | null] {
  const [isIntersecting, setIsIntersecting] = useState(false);
  const [entry, setEntry] = useState<IntersectionObserverEntry | null>(null);
  const [observer, setObserver] = useState<IntersectionObserver | null>(null);

  useEffect(() => {
    const observerInstance = new IntersectionObserver(([entry]) => {
      setIsIntersecting(entry.isIntersecting);
      setEntry(entry);
    }, options);

    setObserver(observerInstance);

  }, [options]);

  useEffect(() => {
    const currentElement = elementRef.current;
    if (currentElement) {
      observer?.observe(currentElement);
    }

    return () => {
      if (currentElement) {
        observer?.unobserve(currentElement);
      }
    };
  }, [elementRef, observer]);

  return [isIntersecting, entry];
}

// Interval hook
export function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;

    const intervalId = setInterval(() => {
      savedCallback.current();
    }, delay);

    return () => clearInterval(intervalId);
  }, [delay]);
}

// Form hook
export function useForm<T extends Record<string, any>>(
  initialValues: T,
  onSubmit: (values: T) => Promise<void> | void
) {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setValue = useCallback((name: keyof T, value: any) => {
    setValues(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: undefined }));
    }
  }, [errors]);

  const setError = useCallback((name: keyof T, error: string) => {
    setErrors(prev => ({ ...prev, [name]: error }));
  }, []);

  const clearErrors = useCallback(() => {
    setErrors({});
  }, []);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }

    setIsSubmitting(true);
    clearErrors();

    try {
      await onSubmit(values);
    } catch (error) {
      if (error instanceof Error) {
        setError('form', error.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [values, onSubmit, clearErrors, setError]);

  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setIsSubmitting(false);
  }, [initialValues]);

  return {
    values,
    errors,
    isSubmitting,
    setValue,
    setError,
    clearErrors,
    handleSubmit,
    reset
  };
}

// Click outside hook
export function useClickOutside<T extends HTMLElement>(
  handler: () => void
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        handler();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [handler]);

  return ref;
}

// Copy to clipboard hook
export function useCopyToClipboard(): [boolean, (text: string) => Promise<void>] {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);

      // Reset after 2 seconds
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy text:', error);
      setIsCopied(false);
    }
  }, []);

  return [isCopied, copyToClipboard];
}

// Query string hook
export function useQueryString(): {
  query: Record<string, string>;
  setQuery: (params: Record<string, string>) => void;
} {
  const [query, setQueryState] = useState<Record<string, string>>({});

  const setQuery = useCallback((params: Record<string, string>) => {
    const newParams = new URLSearchParams(window.location.search);

    // Update existing params
    Object.keys(params).forEach(key => {
      if (params[key] === undefined || params[key] === null) {
        newParams.delete(key);
      } else {
        newParams.set(key, params[key]);
      }
    });

    // Update URL without reload
    const newUrl = `${window.location.pathname}?${newParams.toString()}`;
    window.history.pushState(null, '', newUrl);

    setQueryState(Object.fromEntries(newParams));
  }, []);

  useEffect(() => {
    // Initialize from current URL
    const params = new URLSearchParams(window.location.search);
    setQueryState(Object.fromEntries(params));

    // Handle popstate
    const handlePopstate = () => {
      const params = new URLSearchParams(window.location.search);
      setQueryState(Object.fromEntries(params));
    };

    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  }, []);

  return { query, setQuery };
}

// Selection hook for performance optimization
export function useSelection<T>(): [T[], (item: T, selected: boolean) => void, boolean] {
  const [selectedItems, setSelectedItems] = useState<T[]>([]);

  const toggleItem = useCallback((item: T, selected: boolean) => {
    setSelectedItems(prev => {
      if (selected) {
        return prev.includes(item) ? prev : [...prev, item];
      } else {
        return prev.filter(i => i !== item);
      }
    });
  }, []);

  const isAllSelected = useCallback(() => {
    // This would need to be implemented based on the actual data source
    return false;
  }, []);

  return [selectedItems, toggleItem, isAllSelected()];
}

// Print hook for printing components
export function usePrint(): [boolean, () => void] {
  const [isPrinting, setIsPrinting] = useState(false);

  const handlePrint = useCallback(() => {
    setIsPrinting(true);
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
    }, 100);
  }, []);

  useEffect(() => {
    const handlePrintEvent = (e: BeforePrintEvent) => setIsPrinting(true);
    const handleAfterPrint = () => setIsPrinting(false);

    window.addEventListener('beforeprint', handlePrintEvent);
    window.addEventListener('afterprint', handleAfterPrint);

    return () => {
      window.removeEventListener('beforeprint', handlePrintEvent);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, []);

  return [isPrinting, handlePrint];
}