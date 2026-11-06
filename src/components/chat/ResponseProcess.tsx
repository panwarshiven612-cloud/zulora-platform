import React from 'react';
import ThoughtProcess, { 
  ThinkingStep, 
  GroundingSource, 
  ThoughtProcessProps 
} from './ThoughtProcess';

export type { ThinkingStep, GroundingSource, ThoughtProcessProps as ResponseProcessProps };

export const ResponseProcess: React.FC<ThoughtProcessProps> = (props) => {
  return <ThoughtProcess {...props} />;
};

export default ResponseProcess;
