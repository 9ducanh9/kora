import { ContainerType } from '../ir/types';

export interface ContainerVisualConfig {
  type: ContainerType;
  defaultLabel: string;
  badgePath?: string;
  badgeSize: number;       // Header hierarchy: Cloud (28px) > Region/DC (24px) > VPC (22px) > Subnets (20px) > ASG (18px)
  fontSize: number;        // Title typography (13px -> 10.5px)
  fontWeight: number;
  borderStyle: 'solid' | 'dashed';
  borderWidth: number;
  cssClass: string;
  // Layout padding derived from header geometry + internal margin
  topPadding: number;
  sidePadding: number;
  bottomPadding: number;
}

const CONTAINER_REGISTRY: Record<ContainerType, ContainerVisualConfig> = {
  'cloud': {
    type: 'cloud',
    defaultLabel: 'AWS Cloud',
    badgePath: '/assets/aws/groups/aws-cloud.svg',
    badgeSize: 28,
    fontSize: 13,
    fontWeight: 700,
    borderStyle: 'solid',
    borderWidth: 1.5,
    cssClass: 'container-aws-cloud',
    topPadding: 52,
    sidePadding: 24,
    bottomPadding: 24
  },
  'region': {
    type: 'region',
    defaultLabel: 'Region',
    badgePath: '/assets/aws/groups/aws-region.svg',
    badgeSize: 24,
    fontSize: 12,
    fontWeight: 600,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    cssClass: 'container-region',
    topPadding: 46,
    sidePadding: 20,
    bottomPadding: 20
  },
  'vpc': {
    type: 'vpc',
    defaultLabel: 'VPC',
    badgePath: '/assets/aws/groups/aws-vpc.svg',
    badgeSize: 22,
    fontSize: 11.5,
    fontWeight: 600,
    borderStyle: 'solid',
    borderWidth: 1.5,
    cssClass: 'container-vpc',
    topPadding: 44,
    sidePadding: 20,
    bottomPadding: 20
  },
  'availability-zone': {
    type: 'availability-zone',
    defaultLabel: 'Availability Zone',
    badgeSize: 0,
    fontSize: 11,
    fontWeight: 600,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    cssClass: 'container-availability-zone',
    topPadding: 36,
    sidePadding: 16,
    bottomPadding: 16
  },
  'subnet-public': {
    type: 'subnet-public',
    defaultLabel: 'Public Subnet',
    badgePath: '/assets/aws/groups/aws-subnet-public.svg',
    badgeSize: 20,
    fontSize: 11,
    fontWeight: 600,
    borderStyle: 'solid',
    borderWidth: 1.5,
    cssClass: 'container-subnet-public',
    topPadding: 40,
    sidePadding: 18,
    bottomPadding: 18
  },
  'subnet-private': {
    type: 'subnet-private',
    defaultLabel: 'Private Subnet',
    badgePath: '/assets/aws/groups/aws-subnet-private.svg',
    badgeSize: 20,
    fontSize: 11,
    fontWeight: 600,
    borderStyle: 'solid',
    borderWidth: 1.5,
    cssClass: 'container-subnet-private',
    topPadding: 40,
    sidePadding: 18,
    bottomPadding: 18
  },
  'auto-scaling-group': {
    type: 'auto-scaling-group',
    defaultLabel: 'Auto Scaling Group',
    badgePath: '/assets/aws/groups/aws-auto-scaling-group.svg',
    badgeSize: 18,
    fontSize: 10.5,
    fontWeight: 600,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    cssClass: 'container-auto-scaling-group',
    topPadding: 36,
    sidePadding: 14,
    bottomPadding: 14
  },
  'corporate-data-center': {
    type: 'corporate-data-center',
    defaultLabel: 'Corporate Data Center',
    badgePath: '/assets/aws/groups/aws-corporate-data-center.svg',
    badgeSize: 24,
    fontSize: 12,
    fontWeight: 600,
    borderStyle: 'solid',
    borderWidth: 1.5,
    cssClass: 'container-corporate-data-center',
    topPadding: 46,
    sidePadding: 20,
    bottomPadding: 20
  },
  'security-group': {
    type: 'security-group',
    defaultLabel: 'Security Group',
    badgeSize: 0,
    fontSize: 11,
    fontWeight: 600,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    cssClass: 'container-security-group',
    topPadding: 36,
    sidePadding: 16,
    bottomPadding: 16
  },
  'generic-group': {
    type: 'generic-group',
    defaultLabel: 'Group',
    badgeSize: 0,
    fontSize: 11,
    fontWeight: 600,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    cssClass: 'container-generic-group',
    topPadding: 36,
    sidePadding: 16,
    bottomPadding: 16
  }
};

export function getContainerVisualConfig(type: ContainerType): ContainerVisualConfig {
  return CONTAINER_REGISTRY[type] || CONTAINER_REGISTRY['generic-group'];
}
