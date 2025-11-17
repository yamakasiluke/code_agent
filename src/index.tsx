import React from 'react';
import {render} from 'ink';
import App from './ui/App.js';

const {unmount} = render(<App />);

const handleExit = () => {
  unmount();
  process.exit(0);
};

process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);
