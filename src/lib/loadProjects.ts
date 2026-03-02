// src/lib/loadProjects.ts
import { getApiUrl } from "./publicConfig";

export interface ProjectData {
  id: string;
  title: string;
  description: string;
  image: string;
  tags: string[];
  category: string;
  results: string;
  demoUrl?: string;
  codeUrl?: string;
  powerBiUrl?: string;
  type: 'ml' | 'analytics' | 'powerbi' | 'dashboard';
  featured: boolean;
  createdAt: string;
}

export async function loadProjects(): Promise<ProjectData[]> {
  console.log("LOADING PROJECTS FROM BACKEND...");
  
  try {
    // Use relative URL for backend API
    const response = await fetch(getApiUrl('/api/projects'));
    
    if (!response.ok) {
      console.error('Failed to fetch projects from backend:', response.status, response.statusText);
      // Fallback to static projects if backend fails
      return getStaticProjects();
    }
    
    const data = await response.json();
    console.log("✅ Projects loaded:", data);
    return data.projects.sort((a: ProjectData, b: ProjectData) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch (error) {
    console.error('Error loading projects:', error);
    return getStaticProjects();
  }
}

// Fallback static projects
function getStaticProjects(): ProjectData[] {
  return [
    {
      id: '1',
      title: 'Sales Forecasting Model',
      description: 'Advanced time series analysis and machine learning model to predict sales trends with 95% accuracy.',
      image: '/placeholder.svg',
      tags: ['Python', 'LSTM', 'Time Series', 'TensorFlow'],
      category: 'Machine Learning',
      results: '35% improvement in inventory planning',
      type: 'ml',
      featured: true,
      createdAt: '2024-01-15'
    },
    {
      id: '2',
      title: 'Customer Segmentation Analysis',
      description: 'Comprehensive customer behavior analysis using clustering algorithms to identify key market segments.',
      image: '/placeholder.svg',
      tags: ['R', 'K-Means', 'PCA', 'Visualization'],
      category: 'Data Analytics',
      results: '25% increase in marketing ROI',
      type: 'analytics',
      featured: true,
      createdAt: '2024-01-10'
    },
    {
      id: '3',
      title: 'Real-time Fraud Detection',
      description: 'ML-powered fraud detection system processing millions of transactions with real-time alerts.',
      image: '/placeholder.svg',
      tags: ['Python', 'Anomaly Detection', 'Kafka', 'AWS'],
      category: 'Machine Learning',
      results: '99.7% fraud detection accuracy',
      type: 'ml',
      featured: true,
      createdAt: '2024-01-05'
    },
    {
      id: '4',
      title: 'Supply Chain Optimization',
      description: 'Data-driven optimization of supply chain operations reducing costs and improving efficiency.',
      image: '/placeholder.svg',
      tags: ['Operations Research', 'Optimization', 'Python', 'Tableau'],
      category: 'Analytics',
      results: '20% cost reduction achieved',
      type: 'analytics',
      featured: false,
      createdAt: '2024-01-01'
    },
    {
      id: '5',
      title: 'Sentiment Analysis Dashboard',
      description: 'NLP-powered social media sentiment analysis with interactive dashboards for brand monitoring.',
      image: '/placeholder.svg',
      tags: ['NLP', 'BERT', 'React', 'D3.js'],
      category: 'NLP',
      results: 'Real-time brand monitoring',
      type: 'dashboard',
      featured: false,
      createdAt: '2023-12-20'
    },
    {
      id: '6',
      title: 'Predictive Maintenance System',
      description: 'IoT sensor data analysis to predict equipment failures and optimize maintenance schedules.',
      image: '/placeholder.svg',
      tags: ['IoT', 'Time Series', 'Random Forest', 'Azure'],
      category: 'Predictive Analytics',
      results: '40% reduction in downtime',
      type: 'ml',
      featured: false,
      createdAt: '2023-12-15'
    }
  ];
}

// Function to add Power BI projects later
export function addPowerBiProjects(projects: ProjectData[]): ProjectData[] {
  const powerBiProjects: ProjectData[] = [
    {
      id: 'powerbi-1',
      title: 'Sales Performance Dashboard',
      description: 'Interactive Power BI dashboard showing real-time sales metrics, regional performance, and trend analysis.',
      image: '/images/powerbi-sales.png',
      tags: ['Power BI', 'DAX', 'Sales Analytics', 'Real-time'],
      category: 'Business Intelligence',
      results: '50% faster reporting process',
      type: 'powerbi',
      featured: true,
      createdAt: '2024-01-20',
      powerBiUrl: 'https://app.powerbi.com/view?r=eyJrIjoi...'
    },
    {
      id: 'powerbi-2',
      title: 'Financial Analytics Hub',
      description: 'Comprehensive financial dashboard with budget tracking, variance analysis, and forecasting.',
      image: '/images/powerbi-finance.png',
      tags: ['Power BI', 'Financial Analytics', 'Budget Tracking', 'Forecasting'],
      category: 'Finance',
      results: '30% improvement in budget accuracy',
      type: 'powerbi',
      featured: false,
      createdAt: '2024-01-18',
      powerBiUrl: 'https://app.powerbi.com/view?r=eyJrIjoi...'
    }
  ];
  
  return [...projects, ...powerBiProjects];
}
