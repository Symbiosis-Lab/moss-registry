export type Maybe<T> = T | null | undefined;
export type InputMaybe<T> = T | null | undefined;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  DateTime: { input: any; output: any; }
  Upload: { input: any; output: any; }
  amount_Float_NotNull_exclusiveMin_0: { input: any; output: any; }
  amount_Float_exclusiveMin_0: { input: any; output: any; }
  amount_Int_NotNull_min_1: { input: any; output: any; }
  banDays_Int_exclusiveMin_0: { input: any; output: any; }
  boost_Float_NotNull_min_0: { input: any; output: any; }
  description_String_maxLength_140: { input: any; output: any; }
  email_String_NotNull_format_email: { input: any; output: any; }
  email_String_format_email: { input: any; output: any; }
  first_Int_NotNull_min_0: { input: any; output: any; }
  first_Int_min_0: { input: any; output: any; }
  freePeriod_Int_NotNull_exclusiveMin_0: { input: any; output: any; }
  last_Int_min_0: { input: any; output: any; }
  link_String_NotNull_format_uri: { input: any; output: any; }
  link_String_format_uri: { input: any; output: any; }
  random_Int_min_0_max_49: { input: any; output: any; }
  redirectUrl_String_format_uri: { input: any; output: any; }
  replyToDonator_String_maxLength_140: { input: any; output: any; }
  requestForDonation_String_maxLength_140: { input: any; output: any; }
  url_String_format_uri: { input: any; output: any; }
  website_String_format_uri: { input: any; output: any; }
};

export type AdStatus = {
  /** Whether this article is labeled as ad by human, null for not labeled yet.  */
  isAd?: Maybe<Scalars['Boolean']['output']>;
};

export type AddCollectionsArticlesInput = {
  articles: Array<Scalars['ID']['input']>;
  collections: Array<Scalars['ID']['input']>;
};

export type AddCreditInput = {
  amount: Scalars['amount_Float_NotNull_exclusiveMin_0']['input'];
};

export type AddCreditResult = {
  /** The client secret of this PaymentIntent. */
  client_secret: Scalars['String']['output'];
  transaction: Transaction;
};

export type AddCurationChannelArticlesInput = {
  articles: Array<Scalars['ID']['input']>;
  channel: Scalars['ID']['input'];
};

export type Announcement = {
  channels: Array<AnnouncementChannel>;
  content?: Maybe<Scalars['String']['output']>;
  cover?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  expiredAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  link?: Maybe<Scalars['String']['output']>;
  order: Scalars['Int']['output'];
  title?: Maybe<Scalars['String']['output']>;
  /** @deprecated Use title, content, link with TranslationArgs instead */
  translations?: Maybe<Array<TranslatedAnnouncement>>;
  type: AnnouncementType;
  updatedAt: Scalars['DateTime']['output'];
  visible: Scalars['Boolean']['output'];
};


export type AnnouncementContentArgs = {
  input?: InputMaybe<TranslationArgs>;
};


export type AnnouncementLinkArgs = {
  input?: InputMaybe<TranslationArgs>;
};


export type AnnouncementTitleArgs = {
  input?: InputMaybe<TranslationArgs>;
};

export type AnnouncementChannel = {
  channel: Channel;
  order: Scalars['Int']['output'];
  visible: Scalars['Boolean']['output'];
};

export type AnnouncementChannelInput = {
  channel: Scalars['ID']['input'];
  order: Scalars['Int']['input'];
  visible: Scalars['Boolean']['input'];
};

export type AnnouncementType =
  | 'community'
  | 'product'
  | 'seminar';

export type AnnouncementsInput = {
  channel?: InputMaybe<IdentityInput>;
  id?: InputMaybe<Scalars['ID']['input']>;
  visible?: InputMaybe<Scalars['Boolean']['input']>;
};

export type ApplyCampaignInput = {
  id: Scalars['ID']['input'];
};

export type AppreciateArticleInput = {
  amount: Scalars['amount_Int_NotNull_min_1']['input'];
  id: Scalars['ID']['input'];
  superLike?: InputMaybe<Scalars['Boolean']['input']>;
  token?: InputMaybe<Scalars['String']['input']>;
};

export type Appreciation = {
  amount: Scalars['Int']['output'];
  content: Scalars['String']['output'];
  /** Timestamp of appreciation. */
  createdAt: Scalars['DateTime']['output'];
  purpose: AppreciationPurpose;
  /** Recipient of appreciation. */
  recipient: User;
  /** Sender of appreciation. */
  sender?: Maybe<User>;
  /** Object that appreciation is meant for. */
  target?: Maybe<Article>;
};

export type AppreciationConnection = Connection & {
  edges?: Maybe<Array<AppreciationEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type AppreciationEdge = {
  cursor: Scalars['String']['output'];
  node: Appreciation;
};

export type AppreciationPurpose =
  | 'appreciate'
  | 'appreciateComment'
  | 'appreciateSubsidy'
  | 'firstPost'
  | 'invitationAccepted'
  | 'joinByInvitation'
  | 'joinByTask'
  | 'systemSubsidy';

export type ArchiveUserFailure = {
  id: Scalars['ID']['output'];
  message: Scalars['String']['output'];
};

export type ArchiveUsersInput = {
  ids: Array<Scalars['ID']['input']>;
  password: Scalars['String']['input'];
};

export type ArchiveUsersResult = {
  archived: Array<User>;
  skipped: Array<ArchiveUserFailure>;
};

/**
 * This type contains metadata, content, hash and related data of an article. If you
 * want information about article's comments. Please check Comment type.
 */
export type Article = Node & PinnableWork & {
  /** Access related fields on circle */
  access: ArticleAccess;
  /** Number represents how many times per user can appreciate this article. */
  appreciateLeft: Scalars['Int']['output'];
  /** Limit the nuhmber of appreciate per user. */
  appreciateLimit: Scalars['Int']['output'];
  /** Appreciations history of this article. */
  appreciationsReceived: AppreciationConnection;
  /** Total number of appreciations recieved of this article. */
  appreciationsReceivedTotal: Scalars['Int']['output'];
  /** List of assets are belonged to this article (Only the author can access currently). */
  assets: Array<Asset>;
  /** Author of this article. */
  author: User;
  /** Available translation languages. */
  availableTranslations?: Maybe<Array<UserLanguage>>;
  /** The number of users who bookmarked this article. */
  bookmarkCount: Scalars['Int']['output'];
  bookmarked: Scalars['Boolean']['output'];
  /** Associated campaigns */
  campaigns: Array<ArticleCampaign>;
  /** Whether readers can comment */
  canComment: Scalars['Boolean']['output'];
  /** This value determines if current viewer can SuperLike or not. */
  canSuperLike: Scalars['Boolean']['output'];
  /** Classifications status */
  classification: ArticleClassification;
  /**
   * List of articles added into this article's connections.
   * @deprecated Use connections instead
   */
  collection: ArticleConnection;
  /** Collections of this article. */
  collections: CollectionConnection;
  /** The counting number of comments. */
  commentCount: Scalars['Int']['output'];
  /** List of comments of this article. */
  comments: CommentConnection;
  /** List of articles which added this article into their connections. */
  connectedBy: ArticleConnection;
  connections: ArticleConnection;
  /** Content (HTML) of this article. */
  content: Scalars['String']['output'];
  /** Different foramts of content. */
  contents: ArticleContents;
  /** Article cover's link, set by author */
  cover?: Maybe<Scalars['String']['output']>;
  /** Time of this article was created. */
  createdAt: Scalars['DateTime']['output'];
  /** IPFS hash of this article. */
  dataHash: Scalars['String']['output'];
  /** Cover link that is displayed on the article page */
  displayCover?: Maybe<Scalars['String']['output']>;
  /** Whether current viewer has donated to this article */
  donated: Scalars['Boolean']['output'];
  /** Total number of donation recieved of this article. */
  donationCount: Scalars['Int']['output'];
  /** Donations of this article, grouped by sender */
  donations: ArticleDonationConnection;
  /** List of featured comments of this article. */
  featuredComments: CommentConnection;
  /** Computed federation export eligibility for this article. */
  federationEligibility: ArticleFederationEligibility;
  /** Article-level federation setting override. */
  federationSetting?: Maybe<ArticleFederationSetting>;
  /** This value determines if current viewer has appreciated or not. */
  hasAppreciate: Scalars['Boolean']['output'];
  /** Unique ID of this article */
  id: Scalars['ID']['output'];
  /** Whether the first line of paragraph should be indented */
  indentFirstLine: Scalars['Boolean']['output'];
  /** The iscnId if published to ISCN */
  iscnId?: Maybe<Scalars['String']['output']>;
  /** Original language of content */
  language?: Maybe<Scalars['String']['output']>;
  /** License Type */
  license: ArticleLicenseType;
  /** Media hash, composed of cid encoding, of this article. */
  mediaHash: Scalars['String']['output'];
  /** Whether this article is noindex */
  noindex: Scalars['Boolean']['output'];
  oss: ArticleOss;
  /** The number determines how many comments can be set as pinned comment. */
  pinCommentLeft: Scalars['Int']['output'];
  /** The number determines how many pinned comments can be set. */
  pinCommentLimit: Scalars['Int']['output'];
  /** This value determines if this article is an author selected article or not. */
  pinned: Scalars['Boolean']['output'];
  /** List of pinned comments. */
  pinnedComments?: Maybe<Array<Comment>>;
  /** Cumulative reading time in seconds */
  readTime: Scalars['Float']['output'];
  /** Total number of readers of this article. */
  readerCount: Scalars['Int']['output'];
  /** Related articles to this article. */
  relatedArticles: ArticleConnection;
  /** Donation-related articles to this article. */
  relatedDonationArticles: ArticleConnection;
  remark?: Maybe<Scalars['String']['output']>;
  /** Creator message after support */
  replyToDonator?: Maybe<Scalars['String']['output']>;
  /** Creator message asking for support */
  requestForDonation?: Maybe<Scalars['String']['output']>;
  /** The counting number of this article. */
  responseCount: Scalars['Int']['output'];
  /** List of responses of a article. */
  responses: ResponseConnection;
  /** Time of this article was revised. */
  revisedAt?: Maybe<Scalars['DateTime']['output']>;
  /** Revision Count */
  revisionCount: Scalars['Int']['output'];
  /** Whether content is marked as sensitive by admin */
  sensitiveByAdmin: Scalars['Boolean']['output'];
  /** whether content is marked as sensitive by author */
  sensitiveByAuthor: Scalars['Boolean']['output'];
  /** Short hash for shorter url addressing */
  shortHash: Scalars['String']['output'];
  /** Slugified article title. */
  slug: Scalars['String']['output'];
  /** State of this article. */
  state: ArticleState;
  /**
   * This value determines if current Viewer has bookmarked of not.
   * @deprecated Use bookmarked instead
   */
  subscribed: Scalars['Boolean']['output'];
  /** A short summary for this article. */
  summary: Scalars['String']['output'];
  /** This value determines if the summary is customized or not. */
  summaryCustomized: Scalars['Boolean']['output'];
  /** Tags attached to this article. */
  tags?: Maybe<Array<Tag>>;
  /** Article title. */
  title: Scalars['String']['output'];
  /** Transactions history of this article. */
  transactionsReceivedBy: UserConnection;
  /** Translation of article title and content. */
  translation?: Maybe<ArticleTranslation>;
  /** History versions */
  versions: ArticleVersionsConnection;
  /** Word count of this article. */
  wordCount?: Maybe<Scalars['Int']['output']>;
};


/**
 * This type contains metadata, content, hash and related data of an article. If you
 * want information about article's comments. Please check Comment type.
 */
export type ArticleAppreciationsReceivedArgs = {
  input: ConnectionArgs;
};


/**
 * This type contains metadata, content, hash and related data of an article. If you
 * want information about article's comments. Please check Comment type.
 */
export type ArticleCollectionArgs = {
  input: ConnectionArgs;
};


/**
 * This type contains metadata, content, hash and related data of an article. If you
 * want information about article's comments. Please check Comment type.
 */
export type ArticleCollectionsArgs = {
  input: ConnectionArgs;
};


/**
 * This type contains metadata, content, hash and related data of an article. If you
 * want information about article's comments. Please check Comment type.
 */
export type ArticleCommentsArgs = {
  input: CommentsInput;
};


/**
 * This type contains metadata, content, hash and related data of an article. If you
 * want information about article's comments. Please check Comment type.
 */
export type ArticleConnectedByArgs = {
  input: ConnectionArgs;
};


/**
 * This type contains metadata, content, hash and related data of an article. If you
 * want information about article's comments. Please check Comment type.
 */
export type ArticleConnectionsArgs = {
  input: ConnectionArgs;
};


/**
 * This type contains metadata, content, hash and related data of an article. If you
 * want information about article's comments. Please check Comment type.
 */
export type ArticleDonationsArgs = {
  input: ConnectionArgs;
};


/**
 * This type contains metadata, content, hash and related data of an article. If you
 * want information about article's comments. Please check Comment type.
 */
export type ArticleFeaturedCommentsArgs = {
  input: FeaturedCommentsInput;
};


/**
 * This type contains metadata, content, hash and related data of an article. If you
 * want information about article's comments. Please check Comment type.
 */
export type ArticleRelatedArticlesArgs = {
  input: ConnectionArgs;
};


/**
 * This type contains metadata, content, hash and related data of an article. If you
 * want information about article's comments. Please check Comment type.
 */
export type ArticleRelatedDonationArticlesArgs = {
  input: RelatedDonationArticlesInput;
};


/**
 * This type contains metadata, content, hash and related data of an article. If you
 * want information about article's comments. Please check Comment type.
 */
export type ArticleResponsesArgs = {
  input: ResponsesInput;
};


/**
 * This type contains metadata, content, hash and related data of an article. If you
 * want information about article's comments. Please check Comment type.
 */
export type ArticleTransactionsReceivedByArgs = {
  input: TransactionsReceivedByArgs;
};


/**
 * This type contains metadata, content, hash and related data of an article. If you
 * want information about article's comments. Please check Comment type.
 */
export type ArticleTranslationArgs = {
  input?: InputMaybe<ArticleTranslationInput>;
};


/**
 * This type contains metadata, content, hash and related data of an article. If you
 * want information about article's comments. Please check Comment type.
 */
export type ArticleVersionsArgs = {
  input: ArticleVersionsInput;
};

export type ArticleAccess = {
  circle?: Maybe<Circle>;
  secret?: Maybe<Scalars['String']['output']>;
  type: ArticleAccessType;
};

/** Enums for types of article access */
export type ArticleAccessType =
  | 'paywall'
  | 'public';

export type ArticleArticleNotice = Notice & {
  /** List of notice actors. */
  actors?: Maybe<Array<User>>;
  article: Article;
  /** Time of this notice was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Unique ID of this notice. */
  id: Scalars['ID']['output'];
  target: Article;
  type: ArticleArticleNoticeType;
  /** The value determines if the notice is unread or not. */
  unread: Scalars['Boolean']['output'];
};

export type ArticleArticleNoticeType =
  | 'ArticleNewCollected';

export type ArticleCampaign = {
  campaign: Campaign;
  stage?: Maybe<CampaignStage>;
};

export type ArticleCampaignInput = {
  campaign: Scalars['ID']['input'];
  stage?: InputMaybe<Scalars['ID']['input']>;
};

export type ArticleClassification = {
  topicChannel: TopicChannelClassification;
};

export type ArticleConnection = Connection & {
  edges?: Maybe<Array<ArticleEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type ArticleContents = {
  /** HTML content of this article. */
  html: Scalars['String']['output'];
  /** Markdown content of this article. */
  markdown: Scalars['String']['output'];
};

export type ArticleDonation = {
  id: Scalars['ID']['output'];
  sender?: Maybe<User>;
};

export type ArticleDonationConnection = {
  edges?: Maybe<Array<ArticleDonationEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type ArticleDonationEdge = {
  cursor: Scalars['String']['output'];
  node: ArticleDonation;
};

export type ArticleEdge = {
  cursor: Scalars['String']['output'];
  node: Article;
};

export type ArticleFederationEligibility = {
  effectiveArticleSetting: FederationArticleSettingState;
  eligible: Scalars['Boolean']['output'];
  reason: FederationExportDecisionReason;
};

export type ArticleFederationSetting = {
  articleId: Scalars['ID']['output'];
  state: FederationArticleSettingState;
  updatedBy?: Maybe<Scalars['ID']['output']>;
};

export type ArticleInput = {
  mediaHash?: InputMaybe<Scalars['String']['input']>;
  shortHash?: InputMaybe<Scalars['String']['input']>;
};

/** Enums for types of article license */
export type ArticleLicenseType =
  | 'arr'
  | 'cc_0'
  | 'cc_by_nc_nd_2'
  | 'cc_by_nc_nd_4';

export type ArticleNotice = Notice & {
  /** List of notice actors. */
  actors?: Maybe<Array<User>>;
  /** Time of this notice was created. */
  createdAt: Scalars['DateTime']['output'];
  entities: Array<Node>;
  /** Unique ID of this notice. */
  id: Scalars['ID']['output'];
  target: Article;
  type: ArticleNoticeType;
  /** The value determines if the notice is unread or not. */
  unread: Scalars['Boolean']['output'];
};

export type ArticleNoticeType =
  | 'ArticleMentionedYou'
  | 'ArticleNewAppreciation'
  | 'ArticleNewSubscriber'
  | 'ArticlePublished'
  | 'CircleNewArticle'
  | 'RevisedArticleNotPublished'
  | 'RevisedArticlePublished'
  | 'ScheduledArticlePublished'
  | 'TopicChannelFeedbackAccepted';

export type ArticleOss = {
  adStatus: AdStatus;
  boost: Scalars['Float']['output'];
  inRecommendHottest: Scalars['Boolean']['output'];
  inRecommendIcymi: Scalars['Boolean']['output'];
  inRecommendNewest: Scalars['Boolean']['output'];
  inSearch: Scalars['Boolean']['output'];
  pinHistory: Array<Maybe<PinHistory>>;
  score: Scalars['Float']['output'];
  spamStatus: SpamStatus;
  /** @deprecated Use classification.topicChannel.channels instead */
  topicChannels?: Maybe<Array<ArticleTopicChannel>>;
};

export type ArticleRecommendationActivity = {
  /** Recommended articles */
  nodes?: Maybe<Array<Article>>;
  /** The source type of recommendation */
  source?: Maybe<ArticleRecommendationActivitySource>;
};

export type ArticleRecommendationActivitySource =
  | 'ReadArticlesTags'
  | 'UserDonation';

/** Enums for an article state. */
export type ArticleState =
  | 'active'
  | 'archived'
  | 'banned';

export type ArticleTopicChannel = {
  /** Whether this article is filtered out by anti-flood in this channel */
  antiFlooded: Scalars['Boolean']['output'];
  channel: TopicChannel;
  /** Datetime when this article is classified */
  classicfiedAt: Scalars['DateTime']['output'];
  /** Whether this article channel is enabled */
  enabled: Scalars['Boolean']['output'];
  /** Whether this article is labeled by human, null for not labeled yet.  */
  isLabeled: Scalars['Boolean']['output'];
  /** Whether this article is pinned */
  pinned: Scalars['Boolean']['output'];
  /** Confident score by machine */
  score?: Maybe<Scalars['Float']['output']>;
};

export type ArticleTranslation = {
  content?: Maybe<Scalars['String']['output']>;
  language?: Maybe<Scalars['String']['output']>;
  model?: Maybe<TranslationModel>;
  summary?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Scalars['String']['output']>;
};

export type ArticleTranslationInput = {
  language: UserLanguage;
  model?: InputMaybe<TranslationModel>;
};

export type ArticleVersion = Node & {
  contents: ArticleContents;
  createdAt: Scalars['DateTime']['output'];
  dataHash?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  mediaHash?: Maybe<Scalars['String']['output']>;
  summary: Scalars['String']['output'];
  title: Scalars['String']['output'];
  translation?: Maybe<ArticleTranslation>;
};


export type ArticleVersionTranslationArgs = {
  input?: InputMaybe<ArticleTranslationInput>;
};

export type ArticleVersionEdge = {
  cursor: Scalars['String']['output'];
  node: ArticleVersion;
};

export type ArticleVersionsConnection = Connection & {
  edges: Array<Maybe<ArticleVersionEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type ArticleVersionsInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
};

export type ArticlesSort =
  | 'mostAppreciations'
  | 'mostBookmarks'
  | 'mostComments'
  | 'mostDonations'
  | 'mostReadTime'
  | 'newest';

/** This type contains type, link and related data of an asset. */
export type Asset = {
  /** Time of this asset was created. */
  createdAt: Scalars['DateTime']['output'];
  draft?: Maybe<Scalars['Boolean']['output']>;
  /** Unique ID of this Asset. */
  id: Scalars['ID']['output'];
  /** Link of this asset. */
  path: Scalars['String']['output'];
  /** Types of this asset. */
  type: AssetType;
  uploadURL?: Maybe<Scalars['String']['output']>;
};

/** Enums for asset types. */
export type AssetType =
  | 'announcementCover'
  | 'avatar'
  | 'campaignCover'
  | 'circleAvatar'
  | 'circleCover'
  | 'collectionCover'
  | 'cover'
  | 'embed'
  | 'embedaudio'
  | 'moment'
  | 'oauthClientAvatar'
  | 'profileCover'
  | 'tagCover';

export type AuthResult = {
  auth: Scalars['Boolean']['output'];
  token?: Maybe<Scalars['String']['output']>;
  type: AuthResultType;
  user?: Maybe<User>;
};

export type AuthResultType =
  | 'LinkAccount'
  | 'Login'
  | 'Signup';

export type AuthorsType =
  | 'active'
  | 'appreciated'
  | 'default'
  | 'trendy';

export type Badge = {
  type: BadgeType;
};

export type BadgeType =
  | 'architect'
  | 'carbon_based'
  | 'community_watch'
  | 'golden_motor'
  | 'grand_slam'
  | 'nomad1'
  | 'nomad2'
  | 'nomad3'
  | 'nomad4'
  | 'seed';

export type BadgedUsersInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  type?: InputMaybe<BadgeType>;
};

export type Balance = {
  HKD: Scalars['Float']['output'];
};

export type BanCampaignArticlesInput = {
  articles: Array<Scalars['ID']['input']>;
  campaign: Scalars['ID']['input'];
};

export type BlockchainTransaction = {
  chain: Chain;
  txHash: Scalars['String']['output'];
};

export type BlockedSearchKeyword = {
  /** Time of this search keyword was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Unique ID of bloked search keyword. */
  id: Scalars['ID']['output'];
  /** Types of this search keyword. */
  searchKey: Scalars['String']['output'];
};

export type BoostTypes =
  | 'Article'
  | 'Campaign'
  | 'Tag'
  | 'User';

export type CacheControlScope =
  | 'PRIVATE'
  | 'PUBLIC';

export type Campaign = {
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  shortHash: Scalars['String']['output'];
  state: CampaignState;
};

export type CampaignApplication = {
  createdAt: Scalars['DateTime']['output'];
  state: CampaignApplicationState;
};

export type CampaignApplicationState =
  | 'pending'
  | 'rejected'
  | 'succeeded';

export type CampaignArticleConnection = Connection & {
  edges: Array<CampaignArticleEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type CampaignArticleEdge = {
  announcement: Scalars['Boolean']['output'];
  cursor: Scalars['String']['output'];
  featured: Scalars['Boolean']['output'];
  node: Article;
};

export type CampaignArticleNotice = Notice & {
  /** List of notice actors. */
  actors?: Maybe<Array<User>>;
  article: Article;
  /** Time of this notice was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Unique ID of this notice. */
  id: Scalars['ID']['output'];
  target: Campaign;
  type: CampaignArticleNoticeType;
  /** The value determines if the notice is unread or not. */
  unread: Scalars['Boolean']['output'];
};

export type CampaignArticleNoticeType =
  | 'CampaignArticleFeatured';

export type CampaignArticlesFilter = {
  featured?: InputMaybe<Scalars['Boolean']['input']>;
  stage?: InputMaybe<Scalars['ID']['input']>;
};

export type CampaignArticlesInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<CampaignArticlesFilter>;
  first?: InputMaybe<Scalars['Int']['input']>;
};

export type CampaignConnection = Connection & {
  edges?: Maybe<Array<CampaignEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type CampaignEdge = {
  cursor: Scalars['String']['output'];
  node: Campaign;
};

export type CampaignInput = {
  shortHash: Scalars['String']['input'];
};

export type CampaignOss = {
  boost: Scalars['Float']['output'];
  exclusive: Scalars['Boolean']['output'];
  managers: Array<User>;
};

export type CampaignParticipantConnection = Connection & {
  edges?: Maybe<Array<CampaignParticipantEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type CampaignParticipantEdge = {
  application?: Maybe<CampaignApplication>;
  cursor: Scalars['String']['output'];
  node: User;
};

export type CampaignParticipantsInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  /** return all state participants */
  oss?: InputMaybe<Scalars['Boolean']['input']>;
};

export type CampaignStage = {
  description: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  period?: Maybe<DatetimeRange>;
};


export type CampaignStageDescriptionArgs = {
  input?: InputMaybe<TranslationArgs>;
};


export type CampaignStageNameArgs = {
  input?: InputMaybe<TranslationArgs>;
};

export type CampaignStageInput = {
  description?: InputMaybe<Array<TranslationInput>>;
  name: Array<TranslationInput>;
  period?: InputMaybe<DatetimeRangeInput>;
};

export type CampaignState =
  | 'active'
  | 'archived'
  | 'finished'
  | 'pending';

export type CampaignsFilter = {
  excludes?: InputMaybe<Array<Scalars['ID']['input']>>;
  sort?: InputMaybe<CampaignsFilterSort>;
  state?: InputMaybe<CampaignsFilterState>;
};

export type CampaignsFilterSort =
  | 'writingPeriod';

export type CampaignsFilterState =
  | 'active'
  | 'finished';

export type CampaignsInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<CampaignsFilter>;
  first?: InputMaybe<Scalars['Int']['input']>;
  /** return pending and archived campaigns */
  oss?: InputMaybe<Scalars['Boolean']['input']>;
};

export type Chain =
  | 'Optimism'
  | 'Polygon';

export type Channel = {
  id: Scalars['ID']['output'];
  navbarTitle: Scalars['String']['output'];
  shortHash: Scalars['String']['output'];
};


export type ChannelNavbarTitleArgs = {
  input?: InputMaybe<TranslationArgs>;
};

export type ChannelArticleConnection = Connection & {
  edges?: Maybe<Array<ChannelArticleEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type ChannelArticleEdge = {
  cursor: Scalars['String']['output'];
  node: Article;
  pinned: Scalars['Boolean']['output'];
};

export type ChannelArticlesFilter = {
  datetimeRange?: InputMaybe<DatetimeRangeInput>;
  searchKey?: InputMaybe<Scalars['String']['input']>;
};

export type ChannelArticlesInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<ChannelArticlesFilter>;
  first?: InputMaybe<Scalars['Int']['input']>;
  oss?: InputMaybe<Scalars['Boolean']['input']>;
  sort?: InputMaybe<ArticlesSort>;
};

export type ChannelInput = {
  shortHash: Scalars['String']['input'];
};

export type ChannelsInput = {
  /** return all channels if true, only active channels by default */
  oss?: InputMaybe<Scalars['Boolean']['input']>;
};

export type Circle = Node & {
  /** Analytics dashboard. */
  analytics: CircleAnalytics;
  /**
   * Circle avatar's link.
   * @deprecated No longer in use
   */
  avatar?: Maybe<Scalars['String']['output']>;
  /** Comments broadcasted by Circle owner. */
  broadcast: CommentConnection;
  /**
   * Circle cover's link.
   * @deprecated No longer in use
   */
  cover?: Maybe<Scalars['String']['output']>;
  /**
   * Created time.
   * @deprecated No longer in use
   */
  createdAt: Scalars['DateTime']['output'];
  /** A short description of this Circle. */
  description?: Maybe<Scalars['String']['output']>;
  /** Comments made by Circle member. */
  discussion: CommentConnection;
  /** Discussion (include replies) count of this circle. */
  discussionCount: Scalars['Int']['output'];
  /** Discussion (exclude replies) count of this circle. */
  discussionThreadCount: Scalars['Int']['output'];
  /**
   * Human readable name of this Circle.
   * @deprecated No longer in use
   */
  displayName: Scalars['String']['output'];
  /**
   * List of Circle follower.
   * @deprecated No longer in use
   */
  followers: UserConnection;
  /** Unique ID. */
  id: Scalars['ID']['output'];
  /** Invitation used by current viewer. */
  invitedBy?: Maybe<Invitation>;
  /** Invitations belonged to this Circle. */
  invites: Invites;
  /**
   * This value determines if current viewer is following Circle or not.
   * @deprecated No longer in use
   */
  isFollower: Scalars['Boolean']['output'];
  /**
   * This value determines if current viewer is Member or not.
   * @deprecated No longer in use
   */
  isMember: Scalars['Boolean']['output'];
  /**
   * List of Circle member.
   * @deprecated No longer in use
   */
  members: MemberConnection;
  /**
   * Slugified name of this Circle.
   * @deprecated No longer in use
   */
  name: Scalars['String']['output'];
  /** Circle owner. */
  owner: User;
  /** Pinned comments broadcasted by Circle owner. */
  pinnedBroadcast?: Maybe<Array<Comment>>;
  /** Prices offered by this Circle. */
  prices?: Maybe<Array<Price>>;
  /**
   * State of this Circle.
   * @deprecated No longer in use
   */
  state: CircleState;
  /**
   * Updated time.
   * @deprecated No longer in use
   */
  updatedAt: Scalars['DateTime']['output'];
  /**
   * List of works belong to this Circle.
   * @deprecated No longer in use
   */
  works: ArticleConnection;
};


export type CircleBroadcastArgs = {
  input: CommentsInput;
};


export type CircleDiscussionArgs = {
  input: CommentsInput;
};


export type CircleFollowersArgs = {
  input: ConnectionArgs;
};


export type CircleMembersArgs = {
  input: ConnectionArgs;
};


export type CircleWorksArgs = {
  input: ConnectionArgs;
};

export type CircleAnalytics = {
  content: CircleContentAnalytics;
  follower: CircleFollowerAnalytics;
  income: CircleIncomeAnalytics;
  subscriber: CircleSubscriberAnalytics;
};

export type CircleConnection = Connection & {
  edges?: Maybe<Array<CircleEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type CircleContentAnalytics = {
  paywall?: Maybe<Array<CircleContentAnalyticsDatum>>;
  public?: Maybe<Array<CircleContentAnalyticsDatum>>;
};

export type CircleContentAnalyticsDatum = {
  node: Article;
  readCount: Scalars['Int']['output'];
};

export type CircleEdge = {
  cursor: Scalars['String']['output'];
  node: Circle;
};

export type CircleFollowerAnalytics = {
  /** current follower count */
  current: Scalars['Int']['output'];
  /** the percentage of follower count in reader count of circle articles */
  followerPercentage: Scalars['Float']['output'];
  /** subscriber count history of last 4 months */
  history: Array<MonthlyDatum>;
};

export type CircleIncomeAnalytics = {
  /** income history of last 4 months */
  history: Array<MonthlyDatum>;
  /** income of next month */
  nextMonth: Scalars['Float']['output'];
  /** income of this month */
  thisMonth: Scalars['Float']['output'];
  /** total income of all time */
  total: Scalars['Float']['output'];
};

export type CircleInput = {
  /** Slugified name of a Circle. */
  name: Scalars['String']['input'];
};

export type CircleNotice = Notice & {
  /** List of notice actors. */
  actors?: Maybe<Array<User>>;
  /** Optional discussion/broadcast comments for bundled notices */
  comments?: Maybe<Array<Comment>>;
  /** Time of this notice was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Unique ID of this notice. */
  id: Scalars['ID']['output'];
  /** Optional mention comments for bundled notices */
  mentions?: Maybe<Array<Comment>>;
  /** Optional discussion/broadcast replies for bundled notices */
  replies?: Maybe<Array<Comment>>;
  target: Circle;
  type: CircleNoticeType;
  /** The value determines if the notice is unread or not. */
  unread: Scalars['Boolean']['output'];
};

export type CircleNoticeType =
  | 'CircleInvitation'
  | 'CircleNewBroadcastComments'
  | 'CircleNewDiscussionComments'
  | 'CircleNewFollower'
  | 'CircleNewSubscriber'
  | 'CircleNewUnsubscriber';

export type CircleRecommendationActivity = {
  /** Recommended circles */
  nodes?: Maybe<Array<Circle>>;
  /** The source type of recommendation */
  source?: Maybe<CircleRecommendationActivitySource>;
};

export type CircleRecommendationActivitySource =
  | 'UserSubscription';

export type CircleState =
  | 'active'
  | 'archived';

export type CircleSubscriberAnalytics = {
  /** current invitee count */
  currentInvitee: Scalars['Int']['output'];
  /** current subscriber count */
  currentSubscriber: Scalars['Int']['output'];
  /** invitee count history of last 4 months */
  inviteeHistory: Array<MonthlyDatum>;
  /** subscriber count history of last 4 months */
  subscriberHistory: Array<MonthlyDatum>;
};

export type ClaimLogbooksInput = {
  ethAddress: Scalars['String']['input'];
  /** nonce from generateSigningMessage */
  nonce: Scalars['String']['input'];
  /** sign'ed by wallet */
  signature: Scalars['String']['input'];
  /** the message being sign'ed, including nonce */
  signedMessage: Scalars['String']['input'];
};

export type ClaimLogbooksResult = {
  ids?: Maybe<Array<Scalars['ID']['output']>>;
  txHash: Scalars['String']['output'];
};

export type ClaimPersonhoodBadgeInput = {
  certChainProof: Scalars['String']['input'];
  certChainType?: InputMaybe<Scalars['String']['input']>;
  handoffToken: Scalars['String']['input'];
  userSigProof: Scalars['String']['input'];
};

export type ClassifyArticlesChannelsInput = {
  ids: Array<Scalars['ID']['input']>;
};

export type ClearCommunityWatchOriginalContentInput = {
  note?: InputMaybe<Scalars['String']['input']>;
  uuid: Scalars['ID']['input'];
};

export type ClearReadHistoryInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
};

export type Collection = Node & PinnableWork & {
  articles: ArticleConnection;
  author: User;
  /** Check if the collection contains the article */
  contains: Scalars['Boolean']['output'];
  cover?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  likeCount: Scalars['Int']['output'];
  /** whether current user has liked it */
  liked: Scalars['Boolean']['output'];
  pinned: Scalars['Boolean']['output'];
  title: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};


export type CollectionArticlesArgs = {
  input: CollectionArticlesInput;
};


export type CollectionContainsArgs = {
  input: NodeInput;
};

export type CollectionArticlesInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  includeAfter?: Scalars['Boolean']['input'];
  includeBefore?: Scalars['Boolean']['input'];
  last?: InputMaybe<Scalars['last_Int_min_0']['input']>;
  reversed?: Scalars['Boolean']['input'];
};

export type CollectionConnection = Connection & {
  edges?: Maybe<Array<CollectionEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type CollectionEdge = {
  cursor: Scalars['String']['output'];
  node: Collection;
};

export type CollectionNotice = Notice & {
  /** List of notice actors. */
  actors?: Maybe<Array<User>>;
  /** Time of this notice was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Unique ID of this notice. */
  id: Scalars['ID']['output'];
  target: Collection;
  /** The value determines if the notice is unread or not. */
  unread: Scalars['Boolean']['output'];
};

export type Color =
  | 'brown'
  | 'gray'
  | 'green'
  | 'orange'
  | 'pink'
  | 'purple'
  | 'red'
  | 'yellow';

/** This type contains content, author, descendant comments and related data of a comment. */
export type Comment = Node & {
  /** Author of this comment. */
  author: User;
  /** Descendant comments of this comment. */
  comments: CommentConnection;
  /** Community Watch audit action when this comment was removed by Community Watch. */
  communityWatchAction?: Maybe<CommunityWatchAction>;
  /** Content of this comment. */
  content?: Maybe<Scalars['String']['output']>;
  /** Time of this comment was created. */
  createdAt: Scalars['DateTime']['output'];
  /**
   * The counting number of downvotes.
   * @deprecated No longer in use in querying
   */
  downvotes: Scalars['Int']['output'];
  /** This value determines this comment is from article donator or not. */
  fromDonator: Scalars['Boolean']['output'];
  /** Unique ID of this comment. */
  id: Scalars['ID']['output'];
  /** The value determines current user's vote. */
  myVote?: Maybe<Vote>;
  /** Current comment belongs to which Node. */
  node: Node;
  /** Parent comment of this comment. */
  parentComment?: Maybe<Comment>;
  /** This value determines this comment is pinned or not. */
  pinned: Scalars['Boolean']['output'];
  remark?: Maybe<Scalars['String']['output']>;
  /** A Comment that this comment replied to. */
  replyTo?: Maybe<Comment>;
  spamStatus: SpamStatus;
  /** State of this comment. */
  state: CommentState;
  type: CommentType;
  /** The counting number of upvotes. */
  upvotes: Scalars['Int']['output'];
};


/** This type contains content, author, descendant comments and related data of a comment. */
export type CommentCommentsArgs = {
  input: CommentCommentsInput;
};

export type CommentCommentNotice = Notice & {
  /** List of notice actors. */
  actors?: Maybe<Array<User>>;
  comment: Comment;
  /** Time of this notice was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Unique ID of this notice. */
  id: Scalars['ID']['output'];
  target: Comment;
  type: CommentCommentNoticeType;
  /** The value determines if the notice is unread or not. */
  unread: Scalars['Boolean']['output'];
};

export type CommentCommentNoticeType =
  | 'CommentNewReply';

export type CommentCommentsInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  author?: InputMaybe<Scalars['ID']['input']>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  sort?: InputMaybe<CommentSort>;
};

export type CommentConnection = Connection & {
  edges?: Maybe<Array<CommentEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type CommentEdge = {
  cursor: Scalars['String']['output'];
  node: Comment;
};

export type CommentInput = {
  articleId?: InputMaybe<Scalars['ID']['input']>;
  circleId?: InputMaybe<Scalars['ID']['input']>;
  content: Scalars['String']['input'];
  mentions?: InputMaybe<Array<Scalars['ID']['input']>>;
  momentId?: InputMaybe<Scalars['ID']['input']>;
  parentId?: InputMaybe<Scalars['ID']['input']>;
  replyTo?: InputMaybe<Scalars['ID']['input']>;
  type: CommentType;
};

export type CommentNotice = Notice & {
  /** List of notice actors. */
  actors?: Maybe<Array<User>>;
  /** Time of this notice was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Unique ID of this notice. */
  id: Scalars['ID']['output'];
  target: Comment;
  type: CommentNoticeType;
  /** The value determines if the notice is unread or not. */
  unread: Scalars['Boolean']['output'];
};

export type CommentNoticeType =
  | 'ArticleNewComment'
  | 'CircleNewBroadcast'
  | 'CommentLiked'
  | 'CommentMentionedYou'
  | 'CommentPinned'
  | 'MomentNewComment'
  | 'SubscribedArticleNewComment';

/** Enums for sorting comments by time. */
export type CommentSort =
  | 'newest'
  | 'oldest';

/** Enums for comment state. */
export type CommentState =
  | 'active'
  | 'archived'
  | 'banned'
  | 'collapsed';

export type CommentType =
  | 'article'
  | 'circleBroadcast'
  | 'circleDiscussion'
  | 'moment';

export type CommentsFilter = {
  author?: InputMaybe<Scalars['ID']['input']>;
  parentComment?: InputMaybe<Scalars['ID']['input']>;
  state?: InputMaybe<CommentState>;
};

export type CommentsInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<CommentsFilter>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  includeAfter?: InputMaybe<Scalars['Boolean']['input']>;
  includeBefore?: InputMaybe<Scalars['Boolean']['input']>;
  sort?: InputMaybe<CommentSort>;
};

export type CommunityWatchAction = {
  actionState: CommunityWatchActionState;
  actorDisplayName: Scalars['String']['output'];
  appealState: CommunityWatchAppealState;
  commentId: Scalars['ID']['output'];
  contentCleared: Scalars['Boolean']['output'];
  /** SHA-256 hash of normalized original content for OSS clustering without re-spreading spam text. */
  contentHash?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  originalContent?: Maybe<Scalars['String']['output']>;
  reason: CommunityWatchRemoveCommentReason;
  /** Whether this Community Watch action also created the normal user report flow for staff review. */
  reportSynced: Scalars['Boolean']['output'];
  reviewState: CommunityWatchReviewState;
  sourceId: Scalars['ID']['output'];
  sourceTitle: Scalars['String']['output'];
  sourceType: CommunityWatchActionSourceType;
  /** Public Matters URL for the removed comment when the source still has a public route. */
  sourceUrl?: Maybe<Scalars['String']['output']>;
  /** Public identifier used by the Community Watch transparency page. */
  uuid: Scalars['ID']['output'];
};

export type CommunityWatchActionConnection = Connection & {
  edges?: Maybe<Array<CommunityWatchActionEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type CommunityWatchActionEdge = {
  cursor: Scalars['String']['output'];
  node: CommunityWatchAction;
};

export type CommunityWatchActionInput = {
  uuid: Scalars['ID']['input'];
};

export type CommunityWatchActionSourceType =
  | 'article'
  | 'moment';

export type CommunityWatchActionState =
  | 'active'
  | 'restored'
  | 'voided';

export type CommunityWatchActionsInput = {
  actionState?: InputMaybe<CommunityWatchActionState>;
  after?: InputMaybe<Scalars['String']['input']>;
  appealState?: InputMaybe<CommunityWatchAppealState>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  reason?: InputMaybe<CommunityWatchRemoveCommentReason>;
  reviewState?: InputMaybe<CommunityWatchReviewState>;
};

export type CommunityWatchAppealState =
  | 'none'
  | 'received'
  | 'resolved';

export type CommunityWatchRemoveCommentInput = {
  id: Scalars['ID']['input'];
  reason: CommunityWatchRemoveCommentReason;
};

export type CommunityWatchRemoveCommentReason =
  | 'porn_ad'
  | 'spam_ad';

export type CommunityWatchReviewState =
  | 'pending'
  | 'reason_adjusted'
  | 'reversed'
  | 'upheld';

export type ConfirmVerificationCodeInput = {
  code: Scalars['String']['input'];
  email: Scalars['email_String_NotNull_format_email']['input'];
  type: VerificationCodeType;
};

export type ConnectStripeAccountInput = {
  country: StripeAccountCountry;
};

export type ConnectStripeAccountResult = {
  redirectUrl: Scalars['String']['output'];
};

export type Connection = {
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type ConnectionArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<FilterInput>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  oss?: InputMaybe<Scalars['Boolean']['input']>;
};

export type CreatePersonhoodHandoffInput = {
  challenge: Scalars['String']['input'];
  challengeExpiresAt?: InputMaybe<Scalars['DateTime']['input']>;
};

export type CryptoWallet = {
  address: Scalars['String']['output'];
  /**  does this address own any Travelogger NFTs? this value is cached at most 1day, and refreshed at next `nfts` query  */
  hasNFTs: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  /** NFT assets owned by this wallet address */
  nfts?: Maybe<Array<NftAsset>>;
};

export type CryptoWalletSignaturePurpose =
  | 'airdrop'
  | 'connect'
  | 'login'
  | 'signup';

export type CurationChannel = Channel & Node & {
  /** both activePeriod and state determine if the channel is active */
  activePeriod: DatetimeRange;
  articles: ChannelArticleConnection;
  color: Color;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  navbarTitle: Scalars['String']['output'];
  note?: Maybe<Scalars['String']['output']>;
  pinAmount: Scalars['Int']['output'];
  shortHash: Scalars['String']['output'];
  showRecommendation: Scalars['Boolean']['output'];
  state: CurationChannelState;
};


export type CurationChannelArticlesArgs = {
  input: ChannelArticlesInput;
};


export type CurationChannelNameArgs = {
  input?: InputMaybe<TranslationArgs>;
};


export type CurationChannelNavbarTitleArgs = {
  input?: InputMaybe<TranslationArgs>;
};


export type CurationChannelNoteArgs = {
  input?: InputMaybe<TranslationArgs>;
};

export type CurationChannelState =
  | 'archived'
  | 'editing'
  | 'published';

export type DatetimeRange = {
  end?: Maybe<Scalars['DateTime']['output']>;
  start: Scalars['DateTime']['output'];
};

export type DatetimeRangeInput = {
  end?: InputMaybe<Scalars['DateTime']['input']>;
  start: Scalars['DateTime']['input'];
};

export type DeleteAnnouncementsInput = {
  ids?: InputMaybe<Array<Scalars['ID']['input']>>;
};

export type DeleteCollectionArticlesInput = {
  articles: Array<Scalars['ID']['input']>;
  collection: Scalars['ID']['input'];
};

export type DeleteCollectionsInput = {
  ids: Array<Scalars['ID']['input']>;
};

export type DeleteCommentInput = {
  id: Scalars['ID']['input'];
};

export type DeleteCurationChannelArticlesInput = {
  articles: Array<Scalars['ID']['input']>;
  channel: Scalars['ID']['input'];
};

export type DeleteDraftInput = {
  id: Scalars['ID']['input'];
};

export type DeleteMomentInput = {
  id: Scalars['ID']['input'];
};

export type DeleteTagsInput = {
  ids: Array<Scalars['ID']['input']>;
};

export type DirectImageUploadInput = {
  draft?: InputMaybe<Scalars['Boolean']['input']>;
  entityId?: InputMaybe<Scalars['ID']['input']>;
  entityType: EntityType;
  mime?: InputMaybe<Scalars['String']['input']>;
  type: AssetType;
  url?: InputMaybe<Scalars['url_String_format_uri']['input']>;
};

export type Donator = CryptoWallet | User;

/** This type contains content, collections, assets and related data of a draft. */
export type Draft = Node & {
  /** Access related fields on circle */
  access: DraftAccess;
  /** Published article */
  article?: Maybe<Article>;
  /** List of assets are belonged to this draft. */
  assets: Array<Asset>;
  /** Associated campaigns */
  campaigns: Array<ArticleCampaign>;
  /** Whether readers can comment */
  canComment: Scalars['Boolean']['output'];
  /** @deprecated Use connections instead */
  collection: ArticleConnection;
  /** Collections of this draft. */
  collections: CollectionConnection;
  /** Connection articles of this draft. */
  connections: ArticleConnection;
  /** Content (HTML) of this draft. */
  content?: Maybe<Scalars['String']['output']>;
  /** Draft's cover link. */
  cover?: Maybe<Scalars['String']['output']>;
  /** Time of this draft was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Unique ID of this draft. */
  id: Scalars['ID']['output'];
  /** Whether the first line of paragraph should be indented */
  indentFirstLine: Scalars['Boolean']['output'];
  /** Whether publish to ISCN */
  iscnPublish?: Maybe<Scalars['Boolean']['output']>;
  /** License Type */
  license: ArticleLicenseType;
  /** Media hash, composed of cid encoding, of this draft. */
  mediaHash?: Maybe<Scalars['String']['output']>;
  /** Scheduled publish date of the article. */
  publishAt?: Maybe<Scalars['DateTime']['output']>;
  /** State of draft during publihsing. */
  publishState: PublishState;
  /** Creator message after support */
  replyToDonator?: Maybe<Scalars['String']['output']>;
  /** Creator message asking for support */
  requestForDonation?: Maybe<Scalars['String']['output']>;
  /** Whether content is marked as sensitive by author */
  sensitiveByAuthor: Scalars['Boolean']['output'];
  /** Slugified draft title. */
  slug: Scalars['String']['output'];
  /** Summary of this draft. */
  summary?: Maybe<Scalars['String']['output']>;
  /** This value determines if the summary is customized or not. */
  summaryCustomized: Scalars['Boolean']['output'];
  /** Tags are attached to this draft. */
  tags?: Maybe<Array<Scalars['String']['output']>>;
  /** Draft title. */
  title?: Maybe<Scalars['String']['output']>;
  /** Last time of this draft was upadted. */
  updatedAt: Scalars['DateTime']['output'];
  /** The counting number of words in this draft. */
  wordCount: Scalars['Int']['output'];
};


/** This type contains content, collections, assets and related data of a draft. */
export type DraftCollectionArgs = {
  input: ConnectionArgs;
};


/** This type contains content, collections, assets and related data of a draft. */
export type DraftCollectionsArgs = {
  input: ConnectionArgs;
};


/** This type contains content, collections, assets and related data of a draft. */
export type DraftConnectionsArgs = {
  input: ConnectionArgs;
};

export type DraftAccess = {
  circle?: Maybe<Circle>;
  type: ArticleAccessType;
};

export type DraftConnection = Connection & {
  edges?: Maybe<Array<DraftEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type DraftEdge = {
  cursor: Scalars['String']['output'];
  node: Draft;
};

export type EditArticleInput = {
  accessType?: InputMaybe<ArticleAccessType>;
  /** which campaigns to attach */
  campaigns?: InputMaybe<Array<ArticleCampaignInput>>;
  /** whether readers can comment */
  canComment?: InputMaybe<Scalars['Boolean']['input']>;
  circle?: InputMaybe<Scalars['ID']['input']>;
  /** Deprecated, use connections instead */
  collection?: InputMaybe<Array<Scalars['ID']['input']>>;
  collections?: InputMaybe<Array<Scalars['ID']['input']>>;
  connections?: InputMaybe<Array<Scalars['ID']['input']>>;
  content?: InputMaybe<Scalars['String']['input']>;
  cover?: InputMaybe<Scalars['ID']['input']>;
  /** revision description */
  description?: InputMaybe<Scalars['description_String_maxLength_140']['input']>;
  id: Scalars['ID']['input'];
  indentFirstLine?: InputMaybe<Scalars['Boolean']['input']>;
  /** whether publish to ISCN */
  iscnPublish?: InputMaybe<Scalars['Boolean']['input']>;
  license?: InputMaybe<ArticleLicenseType>;
  pinned?: InputMaybe<Scalars['Boolean']['input']>;
  replyToDonator?: InputMaybe<Scalars['replyToDonator_String_maxLength_140']['input']>;
  requestForDonation?: InputMaybe<Scalars['requestForDonation_String_maxLength_140']['input']>;
  sensitive?: InputMaybe<Scalars['Boolean']['input']>;
  state?: InputMaybe<ArticleState>;
  summary?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type EmailLoginInput = {
  email: Scalars['String']['input'];
  /** used in register */
  language?: InputMaybe<UserLanguage>;
  passwordOrCode: Scalars['String']['input'];
  referralCode?: InputMaybe<Scalars['String']['input']>;
};

export type EntityType =
  | 'announcement'
  | 'article'
  | 'campaign'
  | 'circle'
  | 'collection'
  | 'draft'
  | 'moment'
  | 'tag'
  | 'user';

export type ExchangeRate = {
  from: TransactionCurrency;
  rate: Scalars['Float']['output'];
  to: QuoteCurrency;
  /** Last updated time from currency convertor APIs */
  updatedAt: Scalars['DateTime']['output'];
};

export type ExchangeRatesInput = {
  from?: InputMaybe<TransactionCurrency>;
  to?: InputMaybe<QuoteCurrency>;
};

export type Feature = {
  enabled: Scalars['Boolean']['output'];
  name: FeatureName;
  value?: Maybe<Scalars['Float']['output']>;
};

export type FeatureFlag =
  | 'admin'
  | 'off'
  | 'on'
  | 'seeding';

export type FeatureName =
  | 'add_credit'
  | 'article_channel'
  | 'circle_interact'
  | 'circle_management'
  | 'fingerprint'
  | 'hottest_moment_feed'
  | 'payment'
  | 'payout'
  | 'spam_detection'
  | 'tag_adoption'
  | 'verify_appreciate';

export type FeaturedCommentsInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  sort?: InputMaybe<CommentSort>;
};

export type FeaturedTagsInput = {
  /**  tagIds  */
  ids: Array<Scalars['ID']['input']>;
};

export type FederationArticleSettingState =
  | 'disabled'
  | 'enabled'
  | 'inherit';

export type FederationAuthorSettingState =
  | 'disabled'
  | 'enabled';

export type FederationExportDecisionReason =
  | 'article_disabled'
  | 'article_not_public'
  | 'author_not_opted_in'
  | 'eligible';

export type FilterInput = {
  inRangeEnd?: InputMaybe<Scalars['DateTime']['input']>;
  inRangeStart?: InputMaybe<Scalars['DateTime']['input']>;
  /** Used in User Articles filter, by tags or by time range, or both */
  tagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
};

export type Following = {
  circles: CircleConnection;
  users: UserConnection;
};


export type FollowingCirclesArgs = {
  input: ConnectionArgs;
};


export type FollowingUsersArgs = {
  input: ConnectionArgs;
};

export type FollowingActivity = ArticleRecommendationActivity | CircleRecommendationActivity | UserAddArticleTagActivity | UserBroadcastCircleActivity | UserCreateCircleActivity | UserPostMomentActivity | UserPublishArticleActivity | UserRecommendationActivity;

export type FollowingActivityConnection = Connection & {
  edges?: Maybe<Array<FollowingActivityEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type FollowingActivityEdge = {
  cursor: Scalars['String']['output'];
  node: FollowingActivity;
};

export type FrequentSearchInput = {
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  key?: InputMaybe<Scalars['String']['input']>;
};

export type GenerateSigningMessageInput = {
  address: Scalars['String']['input'];
  purpose?: InputMaybe<SigningMessagePurpose>;
};

export type GrantType =
  | 'authorization_code'
  | 'refresh_token';

export type IcymiTopic = Node & {
  archivedAt?: Maybe<Scalars['DateTime']['output']>;
  articles: Array<Article>;
  id: Scalars['ID']['output'];
  note?: Maybe<Scalars['String']['output']>;
  pinAmount: Scalars['Int']['output'];
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  state: IcymiTopicState;
  title: Scalars['String']['output'];
};


export type IcymiTopicNoteArgs = {
  input?: InputMaybe<TranslationArgs>;
};


export type IcymiTopicTitleArgs = {
  input?: InputMaybe<TranslationArgs>;
};

export type IcymiTopicConnection = Connection & {
  edges: Array<IcymiTopicEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type IcymiTopicEdge = {
  cursor: Scalars['String']['output'];
  node: IcymiTopic;
};

export type IcymiTopicState =
  | 'archived'
  | 'editing'
  | 'published';

export type IdentityInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  shortHash?: InputMaybe<Scalars['String']['input']>;
};

export type Invitation = {
  /** Accepted time. */
  acceptedAt?: Maybe<Scalars['DateTime']['output']>;
  /** Invitation of current Circle. */
  circle: Circle;
  /** Created time. */
  createdAt: Scalars['DateTime']['output'];
  /** Free period of this invitation. */
  freePeriod: Scalars['Int']['output'];
  /** Unique ID. */
  id: Scalars['ID']['output'];
  /** Target person of this invitation. */
  invitee: Invitee;
  /** Creator of this invitation. */
  inviter: User;
  /** Sent time. */
  sentAt: Scalars['DateTime']['output'];
  /** Determine it's specific state. */
  state: InvitationState;
};

export type InvitationConnection = Connection & {
  edges?: Maybe<Array<InvitationEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type InvitationEdge = {
  cursor: Scalars['String']['output'];
  node: Invitation;
};

export type InvitationState =
  | 'accepted'
  | 'pending'
  | 'transfer_failed'
  | 'transfer_succeeded';

export type InviteCircleInput = {
  circleId: Scalars['ID']['input'];
  freePeriod: Scalars['freePeriod_Int_NotNull_exclusiveMin_0']['input'];
  invitees: Array<InviteCircleInvitee>;
};

export type InviteCircleInvitee = {
  email?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
};

export type Invitee = Person | User;

export type Invites = {
  /** Accepted invitation list */
  accepted: InvitationConnection;
  /** Pending invitation list */
  pending: InvitationConnection;
};


export type InvitesAcceptedArgs = {
  input: ConnectionArgs;
};


export type InvitesPendingArgs = {
  input: ConnectionArgs;
};

export type KeywordInput = {
  keyword: Scalars['String']['input'];
};

export type KeywordsInput = {
  keywords?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type LikeCollectionInput = {
  id: Scalars['ID']['input'];
};

export type LikeMomentInput = {
  id: Scalars['ID']['input'];
};

export type Liker = {
  /** Whether liker is a civic liker */
  civicLiker: Scalars['Boolean']['output'];
  /** Liker ID of LikeCoin */
  likerId?: Maybe<Scalars['String']['output']>;
  /** Total LIKE left in wallet. */
  total: Scalars['Float']['output'];
};

export type LogRecordInput = {
  type: LogRecordTypes;
};

export type LogRecordTypes =
  | 'ReadFolloweeArticles'
  | 'ReadFollowingFeed'
  | 'ReadResponseInfoPopUp';

export type Member = {
  /** Price chosen by user when joining a Circle. */
  price: Price;
  /** User who join to a Circle. */
  user: User;
};

export type MemberConnection = Connection & {
  edges?: Maybe<Array<MemberEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type MemberEdge = {
  cursor: Scalars['String']['output'];
  node: Member;
};

export type MergeTagsInput = {
  content: Scalars['String']['input'];
  ids: Array<Scalars['ID']['input']>;
};

export type MigrationInput = {
  files: Array<InputMaybe<Scalars['Upload']['input']>>;
  type?: InputMaybe<MigrationType>;
};

export type MigrationType =
  | 'medium';

export type Moment = Node & {
  adStatus: AdStatus;
  articles: Array<Article>;
  assets: Array<Asset>;
  author: User;
  commentCount: Scalars['Int']['output'];
  commentedFollowees: Array<User>;
  comments: CommentConnection;
  content?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  likeCount: Scalars['Int']['output'];
  /** whether current user has liked it */
  liked: Scalars['Boolean']['output'];
  shortHash: Scalars['String']['output'];
  spamStatus: SpamStatus;
  state: MomentState;
  tags: Array<Maybe<Tag>>;
};


export type MomentCommentsArgs = {
  input: CommentsInput;
};

export type MomentConnection = Connection & {
  edges?: Maybe<Array<MomentEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type MomentEdge = {
  cursor: Scalars['String']['output'];
  node: Moment;
};

export type MomentFeedApplication = {
  createdAt: Scalars['DateTime']['output'];
  reviewedBy?: Maybe<MomentFeedUserReviewedBy>;
  reviewer?: Maybe<User>;
  state: MomentFeedUserState;
  updatedAt: Scalars['DateTime']['output'];
};

export type MomentFeedUserReviewedBy =
  | 'admin'
  | 'seed'
  | 'system';

export type MomentFeedUserState =
  | 'approved'
  | 'pending'
  | 'rejected'
  | 'revoked';

export type MomentFeedUsersInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  states?: InputMaybe<Array<MomentFeedUserState>>;
  userName?: InputMaybe<Scalars['String']['input']>;
};

export type MomentInput = {
  shortHash: Scalars['String']['input'];
};

export type MomentNotice = Notice & {
  /** List of notice actors. */
  actors?: Maybe<Array<User>>;
  /** Time of this notice was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Unique ID of this notice. */
  id: Scalars['ID']['output'];
  target: Moment;
  type: MomentNoticeType;
  /** The value determines if the notice is unread or not. */
  unread: Scalars['Boolean']['output'];
};

export type MomentNoticeType =
  | 'MomentLiked'
  | 'MomentMentionedYou';

export type MomentState =
  | 'active'
  | 'archived';

export type MonthlyDatum = {
  date: Scalars['DateTime']['output'];
  value: Scalars['Float']['output'];
};

export type Mutation = {
  /** Add blocked search keyword to blocked_search_word db */
  addBlockedSearchKeyword: BlockedSearchKeyword;
  /** Add articles to the begining of the collections. */
  addCollectionsArticles: Array<Collection>;
  /** Add Credit to User Wallet */
  addCredit: AddCreditResult;
  addCurationChannelArticles: CurationChannel;
  /** Add a social login to current user. */
  addSocialLogin: User;
  /** Add a wallet login to current user. */
  addWalletLogin: User;
  applyCampaign: Campaign;
  applyMomentFeed: User;
  /** Appreciate an article. */
  appreciateArticle: Article;
  /** Archive multiple users from OSS with per-user results. */
  archiveUsers: ArchiveUsersResult;
  banCampaignArticles: Campaign;
  /** Let Traveloggers owner claims a Logbook, returns transaction hash */
  claimLogbooks: ClaimLogbooksResult;
  /** Claim the carbon based badge with a verified zkID personhood proof. */
  claimPersonhoodBadge: User;
  classifyArticlesChannels: Scalars['Boolean']['output'];
  /** Clear stored original content for a Community Watch action as staff. */
  clearCommunityWatchOriginalContent: CommunityWatchAction;
  /** Clear read history for user. */
  clearReadHistory: User;
  /** Clear search history for user. */
  clearSearchHistory?: Maybe<Scalars['Boolean']['output']>;
  /** Remove a spam comment as a Community Watch member. */
  communityWatchRemoveComment: Comment;
  /** Confirm verification code from email. */
  confirmVerificationCode: Scalars['ID']['output'];
  /** Create Stripe Connect account for Payout */
  connectStripeAccount: ConnectStripeAccountResult;
  /** Create a short-lived token that binds a verifier challenge to the current viewer. */
  createPersonhoodHandoff: PersonhoodHandoff;
  deleteAnnouncements: Scalars['Boolean']['output'];
  /** Delete blocked search keywords from search_history db */
  deleteBlockedSearchKeywords?: Maybe<Scalars['Boolean']['output']>;
  /** Remove articles from the collection. */
  deleteCollectionArticles: Collection;
  deleteCollections: Scalars['Boolean']['output'];
  /** Remove a comment. */
  deleteComment: Comment;
  deleteCurationChannelArticles: CurationChannel;
  /** Remove a draft. */
  deleteDraft?: Maybe<Scalars['Boolean']['output']>;
  deleteMoment: Moment;
  deleteTags?: Maybe<Scalars['Boolean']['output']>;
  directImageUpload: Asset;
  /** Edit an article. */
  editArticle: Article;
  /** Login user. */
  emailLogin: AuthResult;
  /** Get signing message. */
  generateSigningMessage: SigningMessageResult;
  /** Invite others to join circle */
  invite?: Maybe<Array<Invitation>>;
  likeCollection: Collection;
  likeMoment: Moment;
  /** Add specific user behavior record. */
  logRecord?: Maybe<Scalars['Boolean']['output']>;
  /** Mark all received notices as read. */
  markAllNoticesAsRead?: Maybe<Scalars['Boolean']['output']>;
  mergeTags: Tag;
  /** Migrate articles from other service provider. */
  migration?: Maybe<Scalars['Boolean']['output']>;
  /** Pay to another user or article */
  payTo: PayToResult;
  /** Payout to user */
  payout: Transaction;
  /** Pin a comment. */
  pinComment: Comment;
  /** Publish an article onto IPFS. */
  publishArticle: Draft;
  putAnnouncement: Announcement;
  putArticleFederationSetting: ArticleFederationSetting;
  /** Create or update a Circle. */
  putCircle: Circle;
  /**
   * Add or remove Circle's articles
   * @deprecated No longer in use
   */
  putCircleArticles: Circle;
  putCollection: Collection;
  /** Publish or update a comment. */
  putComment: Comment;
  putCurationChannel: CurationChannel;
  /** Create or update a draft. */
  putDraft: Draft;
  /** update tags for showing on profile page */
  putFeaturedTags?: Maybe<Array<Tag>>;
  putIcymiTopic?: Maybe<IcymiTopic>;
  putMoment: Moment;
  /** Create or Update an OAuth Client, used in OSS. */
  putOAuthClient?: Maybe<OAuthClient>;
  putRemark?: Maybe<Scalars['String']['output']>;
  putRestrictedUsers: Array<User>;
  putSkippedListItem?: Maybe<Array<SkippedListItem>>;
  putTagChannel: Tag;
  putTopicChannel: TopicChannel;
  putUserFeatureFlags: Array<User>;
  putUserFederationSetting: UserFederationSetting;
  putWritingChallenge: WritingChallenge;
  /** Read an article. */
  readArticle: Article;
  /** Remove a social login from current user. */
  removeSocialLogin: User;
  /** Remove a wallet login from current user. */
  removeWalletLogin: User;
  renameTag: Tag;
  reorderChannels: Scalars['Boolean']['output'];
  /** Reorder articles in the collection. */
  reorderCollectionArticles: Collection;
  /** Reset Liker ID */
  resetLikerId: User;
  /** Reset user or payment password. */
  resetPassword?: Maybe<Scalars['Boolean']['output']>;
  /** Restore a comment removed by Community Watch as staff. */
  restoreCommunityWatchComment: CommunityWatchAction;
  reviewTopicChannelFeedback: TopicChannelFeedback;
  sendCampaignAnnouncement?: Maybe<Scalars['Boolean']['output']>;
  /** Send verification code for email. */
  sendVerificationCode?: Maybe<Scalars['Boolean']['output']>;
  setAdStatus: Article;
  /** Set current author's Fediverse federation preference for an article. */
  setArticleFederationSetting: ArticleFederationSetting;
  setArticleTopicChannels: Article;
  setBoost: Node;
  /** Set user currency preference. */
  setCurrency: User;
  /** Set user email. */
  setEmail: User;
  setFeature: Feature;
  /** Set user email login password. */
  setPassword: User;
  setSpamStatus: Writing;
  /** Set user name. */
  setUserName: User;
  /** Set current viewer's Fediverse federation preference. */
  setViewerFederationSetting: UserFederationSetting;
  setWritingAdStatus: Writing;
  /** Upload a single file. */
  singleFileUpload: Asset;
  /** Login/Signup via social accounts. */
  socialLogin: AuthResult;
  /** Submit inappropriate content report */
  submitReport: Report;
  /** Feedback on topic channel classification */
  submitTopicChannelFeedback: TopicChannelFeedback;
  /** Subscribe a Circle. */
  subscribeCircle: SubscribeCircleResult;
  toggleArticleRecommend: Article;
  /** Block or Unblock a given user. */
  toggleBlockUser: User;
  toggleBookmarkArticle: Article;
  toggleBookmarkTag: Tag;
  /**
   * Follow or unfollow a Circle.
   * @deprecated No longer in use
   */
  toggleFollowCircle: Circle;
  /**
   * Bookmark or unbookmark tag.
   * @deprecated Use toggleBookmarkTag instead
   */
  toggleFollowTag: Tag;
  /** Follow or Unfollow current user. */
  toggleFollowUser: User;
  togglePinChannelArticles: Array<Channel>;
  /** Pin or Unpin a comment. */
  togglePinComment: Comment;
  toggleSeedingUsers: Array<Maybe<User>>;
  /**
   * Bookmark or unbookmark article
   * @deprecated Use toggleBookmarkArticle instead
   */
  toggleSubscribeArticle: Article;
  toggleUsersBadge: Array<Maybe<User>>;
  toggleWritingChallengeFeaturedArticles: Campaign;
  unbindLikerId: User;
  unlikeCollection: Collection;
  unlikeMoment: Moment;
  /** Unpin a comment. */
  unpinComment: Comment;
  /** Unsubscribe a Circle. */
  unsubscribeCircle: Circle;
  /** Unvote a comment. */
  unvoteComment: Comment;
  updateArticleSensitive: Article;
  updateArticleState: Article;
  updateCampaignApplicationState: Campaign;
  /** Update a comments' state. */
  updateCommentsState: Array<Comment>;
  /** Update Community Watch appeal, review, or reason as staff. */
  updateCommunityWatchActionState: CommunityWatchAction;
  updateMomentFeedApplicationState: User;
  /** Update user notification settings. */
  updateNotificationSetting: User;
  /** Update referralCode of a user, used in OSS. */
  updateUserExtra: User;
  /** Update user information. */
  updateUserInfo: User;
  /** Update state of a user, used in OSS. */
  updateUserRole: User;
  /** Update state of a user, used in OSS. */
  updateUserState?: Maybe<Array<User>>;
  /** Logout user. */
  userLogout: Scalars['Boolean']['output'];
  /** Verify user email. */
  verifyEmail: AuthResult;
  /** Upvote or downvote a comment. */
  voteComment: Comment;
  /** Login/Signup via a wallet. */
  walletLogin: AuthResult;
  /** Withdraw locked ERC20/native token from donation vault */
  withdrawLockedTokens: WithdrawLockedTokensResult;
};


export type MutationAddBlockedSearchKeywordArgs = {
  input: KeywordInput;
};


export type MutationAddCollectionsArticlesArgs = {
  input: AddCollectionsArticlesInput;
};


export type MutationAddCreditArgs = {
  input: AddCreditInput;
};


export type MutationAddCurationChannelArticlesArgs = {
  input: AddCurationChannelArticlesInput;
};


export type MutationAddSocialLoginArgs = {
  input: SocialLoginInput;
};


export type MutationAddWalletLoginArgs = {
  input: WalletLoginInput;
};


export type MutationApplyCampaignArgs = {
  input: ApplyCampaignInput;
};


export type MutationAppreciateArticleArgs = {
  input: AppreciateArticleInput;
};


export type MutationArchiveUsersArgs = {
  input: ArchiveUsersInput;
};


export type MutationBanCampaignArticlesArgs = {
  input: BanCampaignArticlesInput;
};


export type MutationClaimLogbooksArgs = {
  input: ClaimLogbooksInput;
};


export type MutationClaimPersonhoodBadgeArgs = {
  input: ClaimPersonhoodBadgeInput;
};


export type MutationClassifyArticlesChannelsArgs = {
  input: ClassifyArticlesChannelsInput;
};


export type MutationClearCommunityWatchOriginalContentArgs = {
  input: ClearCommunityWatchOriginalContentInput;
};


export type MutationClearReadHistoryArgs = {
  input: ClearReadHistoryInput;
};


export type MutationCommunityWatchRemoveCommentArgs = {
  input: CommunityWatchRemoveCommentInput;
};


export type MutationConfirmVerificationCodeArgs = {
  input: ConfirmVerificationCodeInput;
};


export type MutationConnectStripeAccountArgs = {
  input: ConnectStripeAccountInput;
};


export type MutationCreatePersonhoodHandoffArgs = {
  input: CreatePersonhoodHandoffInput;
};


export type MutationDeleteAnnouncementsArgs = {
  input: DeleteAnnouncementsInput;
};


export type MutationDeleteBlockedSearchKeywordsArgs = {
  input: KeywordsInput;
};


export type MutationDeleteCollectionArticlesArgs = {
  input: DeleteCollectionArticlesInput;
};


export type MutationDeleteCollectionsArgs = {
  input: DeleteCollectionsInput;
};


export type MutationDeleteCommentArgs = {
  input: DeleteCommentInput;
};


export type MutationDeleteCurationChannelArticlesArgs = {
  input: DeleteCurationChannelArticlesInput;
};


export type MutationDeleteDraftArgs = {
  input: DeleteDraftInput;
};


export type MutationDeleteMomentArgs = {
  input: DeleteMomentInput;
};


export type MutationDeleteTagsArgs = {
  input: DeleteTagsInput;
};


export type MutationDirectImageUploadArgs = {
  input: DirectImageUploadInput;
};


export type MutationEditArticleArgs = {
  input: EditArticleInput;
};


export type MutationEmailLoginArgs = {
  input: EmailLoginInput;
};


export type MutationGenerateSigningMessageArgs = {
  input: GenerateSigningMessageInput;
};


export type MutationInviteArgs = {
  input: InviteCircleInput;
};


export type MutationLikeCollectionArgs = {
  input: LikeCollectionInput;
};


export type MutationLikeMomentArgs = {
  input: LikeMomentInput;
};


export type MutationLogRecordArgs = {
  input: LogRecordInput;
};


export type MutationMergeTagsArgs = {
  input: MergeTagsInput;
};


export type MutationMigrationArgs = {
  input: MigrationInput;
};


export type MutationPayToArgs = {
  input: PayToInput;
};


export type MutationPayoutArgs = {
  input: PayoutInput;
};


export type MutationPinCommentArgs = {
  input: PinCommentInput;
};


export type MutationPublishArticleArgs = {
  input: PublishArticleInput;
};


export type MutationPutAnnouncementArgs = {
  input: PutAnnouncementInput;
};


export type MutationPutArticleFederationSettingArgs = {
  input: PutArticleFederationSettingInput;
};


export type MutationPutCircleArgs = {
  input: PutCircleInput;
};


export type MutationPutCircleArticlesArgs = {
  input: PutCircleArticlesInput;
};


export type MutationPutCollectionArgs = {
  input: PutCollectionInput;
};


export type MutationPutCommentArgs = {
  input: PutCommentInput;
};


export type MutationPutCurationChannelArgs = {
  input: PutCurationChannelInput;
};


export type MutationPutDraftArgs = {
  input: PutDraftInput;
};


export type MutationPutFeaturedTagsArgs = {
  input: FeaturedTagsInput;
};


export type MutationPutIcymiTopicArgs = {
  input: PutIcymiTopicInput;
};


export type MutationPutMomentArgs = {
  input: PutMomentInput;
};


export type MutationPutOAuthClientArgs = {
  input: PutOAuthClientInput;
};


export type MutationPutRemarkArgs = {
  input: PutRemarkInput;
};


export type MutationPutRestrictedUsersArgs = {
  input: PutRestrictedUsersInput;
};


export type MutationPutSkippedListItemArgs = {
  input: PutSkippedListItemInput;
};


export type MutationPutTagChannelArgs = {
  input: PutTagChannelInput;
};


export type MutationPutTopicChannelArgs = {
  input: PutTopicChannelInput;
};


export type MutationPutUserFeatureFlagsArgs = {
  input: PutUserFeatureFlagsInput;
};


export type MutationPutUserFederationSettingArgs = {
  input: PutUserFederationSettingInput;
};


export type MutationPutWritingChallengeArgs = {
  input: PutWritingChallengeInput;
};


export type MutationReadArticleArgs = {
  input: ReadArticleInput;
};


export type MutationRemoveSocialLoginArgs = {
  input: RemoveSocialLoginInput;
};


export type MutationRenameTagArgs = {
  input: RenameTagInput;
};


export type MutationReorderChannelsArgs = {
  input: ReorderChannelsInput;
};


export type MutationReorderCollectionArticlesArgs = {
  input: ReorderCollectionArticlesInput;
};


export type MutationResetLikerIdArgs = {
  input: ResetLikerIdInput;
};


export type MutationResetPasswordArgs = {
  input: ResetPasswordInput;
};


export type MutationRestoreCommunityWatchCommentArgs = {
  input: RestoreCommunityWatchCommentInput;
};


export type MutationReviewTopicChannelFeedbackArgs = {
  input: ReviewTopicChannelFeedbackInput;
};


export type MutationSendCampaignAnnouncementArgs = {
  input: SendCampaignAnnouncementInput;
};


export type MutationSendVerificationCodeArgs = {
  input: SendVerificationCodeInput;
};


export type MutationSetAdStatusArgs = {
  input: SetAdStatusInput;
};


export type MutationSetArticleFederationSettingArgs = {
  input: SetArticleFederationSettingInput;
};


export type MutationSetArticleTopicChannelsArgs = {
  input: SetArticleTopicChannelsInput;
};


export type MutationSetBoostArgs = {
  input: SetBoostInput;
};


export type MutationSetCurrencyArgs = {
  input: SetCurrencyInput;
};


export type MutationSetEmailArgs = {
  input: SetEmailInput;
};


export type MutationSetFeatureArgs = {
  input: SetFeatureInput;
};


export type MutationSetPasswordArgs = {
  input: SetPasswordInput;
};


export type MutationSetSpamStatusArgs = {
  input: SetSpamStatusInput;
};


export type MutationSetUserNameArgs = {
  input: SetUserNameInput;
};


export type MutationSetViewerFederationSettingArgs = {
  input: SetViewerFederationSettingInput;
};


export type MutationSetWritingAdStatusArgs = {
  input: SetAdStatusInput;
};


export type MutationSingleFileUploadArgs = {
  input: SingleFileUploadInput;
};


export type MutationSocialLoginArgs = {
  input: SocialLoginInput;
};


export type MutationSubmitReportArgs = {
  input: SubmitReportInput;
};


export type MutationSubmitTopicChannelFeedbackArgs = {
  input: SubmitTopicChannelFeedbackInput;
};


export type MutationSubscribeCircleArgs = {
  input: SubscribeCircleInput;
};


export type MutationToggleArticleRecommendArgs = {
  input: ToggleRecommendInput;
};


export type MutationToggleBlockUserArgs = {
  input: ToggleItemInput;
};


export type MutationToggleBookmarkArticleArgs = {
  input: ToggleItemInput;
};


export type MutationToggleBookmarkTagArgs = {
  input: ToggleItemInput;
};


export type MutationToggleFollowCircleArgs = {
  input: ToggleItemInput;
};


export type MutationToggleFollowTagArgs = {
  input: ToggleItemInput;
};


export type MutationToggleFollowUserArgs = {
  input: ToggleItemInput;
};


export type MutationTogglePinChannelArticlesArgs = {
  input: TogglePinChannelArticlesInput;
};


export type MutationTogglePinCommentArgs = {
  input: ToggleItemInput;
};


export type MutationToggleSeedingUsersArgs = {
  input: ToggleSeedingUsersInput;
};


export type MutationToggleSubscribeArticleArgs = {
  input: ToggleItemInput;
};


export type MutationToggleUsersBadgeArgs = {
  input: ToggleUsersBadgeInput;
};


export type MutationToggleWritingChallengeFeaturedArticlesArgs = {
  input: ToggleWritingChallengeFeaturedArticlesInput;
};


export type MutationUnbindLikerIdArgs = {
  input: UnbindLikerIdInput;
};


export type MutationUnlikeCollectionArgs = {
  input: UnlikeCollectionInput;
};


export type MutationUnlikeMomentArgs = {
  input: UnlikeMomentInput;
};


export type MutationUnpinCommentArgs = {
  input: UnpinCommentInput;
};


export type MutationUnsubscribeCircleArgs = {
  input: UnsubscribeCircleInput;
};


export type MutationUnvoteCommentArgs = {
  input: UnvoteCommentInput;
};


export type MutationUpdateArticleSensitiveArgs = {
  input: UpdateArticleSensitiveInput;
};


export type MutationUpdateArticleStateArgs = {
  input: UpdateArticleStateInput;
};


export type MutationUpdateCampaignApplicationStateArgs = {
  input: UpdateCampaignApplicationStateInput;
};


export type MutationUpdateCommentsStateArgs = {
  input: UpdateCommentsStateInput;
};


export type MutationUpdateCommunityWatchActionStateArgs = {
  input: UpdateCommunityWatchActionStateInput;
};


export type MutationUpdateMomentFeedApplicationStateArgs = {
  input: UpdateMomentFeedApplicationStateInput;
};


export type MutationUpdateNotificationSettingArgs = {
  input: UpdateNotificationSettingInput;
};


export type MutationUpdateUserExtraArgs = {
  input: UpdateUserExtraInput;
};


export type MutationUpdateUserInfoArgs = {
  input: UpdateUserInfoInput;
};


export type MutationUpdateUserRoleArgs = {
  input: UpdateUserRoleInput;
};


export type MutationUpdateUserStateArgs = {
  input: UpdateUserStateInput;
};


export type MutationVerifyEmailArgs = {
  input: VerifyEmailInput;
};


export type MutationVoteCommentArgs = {
  input: VoteCommentInput;
};


export type MutationWalletLoginArgs = {
  input: WalletLoginInput;
};

/**  NFT Asset  */
export type NftAsset = {
  collectionName: Scalars['String']['output'];
  /** imageOriginalUrl: String! */
  contractAddress: Scalars['String']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  imagePreviewUrl?: Maybe<Scalars['String']['output']>;
  imageUrl: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type Node = {
  id: Scalars['ID']['output'];
};

export type NodeInput = {
  id: Scalars['ID']['input'];
};

export type NodesInput = {
  ids: Array<Scalars['ID']['input']>;
};

/** This interface contains common fields of a notice. */
export type Notice = {
  /** Time of this notice was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Unique ID of this notice. */
  id: Scalars['ID']['output'];
  /** The value determines if the notice is unread or not. */
  unread: Scalars['Boolean']['output'];
};

export type NoticeConnection = Connection & {
  edges?: Maybe<Array<NoticeEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type NoticeEdge = {
  cursor: Scalars['String']['output'];
  node: Notice;
};

export type NotificationSetting = {
  articleNewAppreciation: Scalars['Boolean']['output'];
  articleNewCollected: Scalars['Boolean']['output'];
  articleNewComment: Scalars['Boolean']['output'];
  articleNewSubscription: Scalars['Boolean']['output'];
  circleMemberNewBroadcastReply: Scalars['Boolean']['output'];
  circleMemberNewDiscussion: Scalars['Boolean']['output'];
  circleMemberNewDiscussionReply: Scalars['Boolean']['output'];
  circleNewFollower: Scalars['Boolean']['output'];
  /** for circle owners */
  circleNewSubscriber: Scalars['Boolean']['output'];
  circleNewUnsubscriber: Scalars['Boolean']['output'];
  email: Scalars['Boolean']['output'];
  /** for circle members & followers */
  inCircleNewArticle: Scalars['Boolean']['output'];
  inCircleNewBroadcast: Scalars['Boolean']['output'];
  inCircleNewBroadcastReply: Scalars['Boolean']['output'];
  inCircleNewDiscussion: Scalars['Boolean']['output'];
  inCircleNewDiscussionReply: Scalars['Boolean']['output'];
  mention: Scalars['Boolean']['output'];
  newComment: Scalars['Boolean']['output'];
  newLike: Scalars['Boolean']['output'];
  userNewFollower: Scalars['Boolean']['output'];
};

export type NotificationSettingType =
  | 'articleNewAppreciation'
  | 'articleNewCollected'
  | 'articleNewComment'
  | 'articleNewSubscription'
  | 'circleMemberBroadcast'
  | 'circleMemberNewBroadcastReply'
  | 'circleMemberNewDiscussion'
  | 'circleMemberNewDiscussionReply'
  | 'circleNewDiscussion'
  | 'circleNewFollower'
  /** for circle owners */
  | 'circleNewSubscriber'
  | 'circleNewUnsubscriber'
  | 'email'
  /** for circle members */
  | 'inCircleNewArticle'
  | 'inCircleNewBroadcast'
  | 'inCircleNewBroadcastReply'
  | 'inCircleNewDiscussion'
  | 'inCircleNewDiscussionReply'
  | 'mention'
  | 'newComment'
  | 'newLike'
  | 'userNewFollower';

export type OAuthClient = {
  /** URL for oauth client's avatar. */
  avatar?: Maybe<Scalars['String']['output']>;
  /** Creation Date */
  createdAt: Scalars['DateTime']['output'];
  /** App Description */
  description?: Maybe<Scalars['String']['output']>;
  /** Grant Types */
  grantTypes?: Maybe<Array<GrantType>>;
  /** Unique Client ID of this OAuth Client. */
  id: Scalars['ID']['output'];
  /** App name */
  name: Scalars['String']['output'];
  /** Redirect URIs */
  redirectURIs?: Maybe<Array<Scalars['String']['output']>>;
  /** Scopes */
  scope?: Maybe<Array<Scalars['String']['output']>>;
  /** Client secret */
  secret: Scalars['String']['output'];
  /** Linked Developer Account */
  user?: Maybe<User>;
  /** URL for oauth client's official website */
  website?: Maybe<Scalars['String']['output']>;
};

export type OAuthClientConnection = Connection & {
  edges?: Maybe<Array<OAuthClientEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type OAuthClientEdge = {
  cursor: Scalars['String']['output'];
  node: OAuthClient;
};

export type OAuthClientInput = {
  id: Scalars['ID']['input'];
};

export type Oss = {
  articles: ArticleConnection;
  badgedUsers: UserConnection;
  comments: CommentConnection;
  icymiTopics: IcymiTopicConnection;
  momentFeedUsers: UserConnection;
  moments: MomentConnection;
  oauthClients: OAuthClientConnection;
  reports: ReportConnection;
  restrictedUsers: UserConnection;
  seedingUsers: UserConnection;
  skippedListItems: SkippedListItemsConnection;
  tags: TagConnection;
  topicChannelFeedbacks: TopicChannelFeedbackConnection;
  users: UserConnection;
};


export type OssArticlesArgs = {
  input: OssArticlesInput;
};


export type OssBadgedUsersArgs = {
  input: BadgedUsersInput;
};


export type OssCommentsArgs = {
  input: ConnectionArgs;
};


export type OssIcymiTopicsArgs = {
  input: ConnectionArgs;
};


export type OssMomentFeedUsersArgs = {
  input: MomentFeedUsersInput;
};


export type OssMomentsArgs = {
  input: ConnectionArgs;
};


export type OssOauthClientsArgs = {
  input: ConnectionArgs;
};


export type OssReportsArgs = {
  input: OssReportsInput;
};


export type OssRestrictedUsersArgs = {
  input: ConnectionArgs;
};


export type OssSeedingUsersArgs = {
  input: ConnectionArgs;
};


export type OssSkippedListItemsArgs = {
  input: SkippedListItemsInput;
};


export type OssTagsArgs = {
  input: TagsInput;
};


export type OssTopicChannelFeedbacksArgs = {
  input: TopicChannelFeedbacksInput;
};


export type OssUsersArgs = {
  input: ConnectionArgs;
};

export type OssArticlesFilterInput = {
  datetimeRange?: InputMaybe<DatetimeRangeInput>;
  isSpam?: InputMaybe<Scalars['Boolean']['input']>;
  searchKey?: InputMaybe<Scalars['String']['input']>;
};

export type OssArticlesInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<OssArticlesFilterInput>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  sort?: InputMaybe<ArticlesSort>;
};

export type OssReportsFilter = {
  source?: InputMaybe<ReportSource>;
};

export type OssReportsInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<OssReportsFilter>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
};

export type Oauth1CredentialInput = {
  oauthToken: Scalars['String']['input'];
  oauthVerifier: Scalars['String']['input'];
};

/** This type contains system-wise info and settings. */
export type Official = {
  /** Announcements */
  announcements?: Maybe<Array<Announcement>>;
  /** Feature flag */
  features: Array<Feature>;
};


/** This type contains system-wise info and settings. */
export type OfficialAnnouncementsArgs = {
  input: AnnouncementsInput;
};

/** The notice type contains info about official announcement. */
export type OfficialAnnouncementNotice = Notice & {
  /** Time of this notice was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Unique ID of this notice. */
  id: Scalars['ID']['output'];
  /** The link to a specific page if provided. */
  link?: Maybe<Scalars['String']['output']>;
  /** The message content. */
  message: Scalars['String']['output'];
  /** The value determines if the notice is unread or not. */
  unread: Scalars['Boolean']['output'];
};

export type PageInfo = {
  endCursor?: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
  hasPreviousPage: Scalars['Boolean']['output'];
  startCursor?: Maybe<Scalars['String']['output']>;
};

export type PayToInput = {
  amount: Scalars['amount_Float_NotNull_exclusiveMin_0']['input'];
  /** for ERC20/native token payment */
  chain?: InputMaybe<Chain>;
  currency: TransactionCurrency;
  id?: InputMaybe<Scalars['ID']['input']>;
  /** for HKD payment */
  password?: InputMaybe<Scalars['String']['input']>;
  purpose: TransactionPurpose;
  recipientId: Scalars['ID']['input'];
  targetId?: InputMaybe<Scalars['ID']['input']>;
  txHash?: InputMaybe<Scalars['String']['input']>;
};

export type PayToResult = {
  /** Only available when paying with LIKE. */
  redirectUrl?: Maybe<Scalars['String']['output']>;
  transaction: Transaction;
};

export type PayoutInput = {
  amount: Scalars['amount_Float_NotNull_exclusiveMin_0']['input'];
  password: Scalars['String']['input'];
};

export type Person = {
  email: Scalars['email_String_NotNull_format_email']['output'];
};

export type PersonhoodHandoff = {
  expiresAt: Scalars['DateTime']['output'];
  token: Scalars['String']['output'];
};

export type PinCommentInput = {
  id: Scalars['ID']['input'];
};

export type PinHistory = {
  /** Which feed (IcymiTopic / Channel) the article was pinned */
  feed: Node;
  pinnedAt: Scalars['DateTime']['output'];
};

export type PinnableWork = {
  cover?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  pinned: Scalars['Boolean']['output'];
  title: Scalars['String']['output'];
};

export type Price = {
  /** Amount of Price. */
  amount: Scalars['Float']['output'];
  /** Current Price belongs to whcih Circle. */
  circle: Circle;
  /**
   * Created time.
   * @deprecated No longer in use
   */
  createdAt: Scalars['DateTime']['output'];
  /** Currency of Price. */
  currency: TransactionCurrency;
  /** Unique ID. */
  id: Scalars['ID']['output'];
  /** State of Price. */
  state: PriceState;
  /**
   * Updated time.
   * @deprecated No longer in use
   */
  updatedAt: Scalars['DateTime']['output'];
};

export type PriceState =
  | 'active'
  | 'archived';

export type PublishArticleInput = {
  id: Scalars['ID']['input'];
  /** whether publish to ISCN */
  iscnPublish?: InputMaybe<Scalars['Boolean']['input']>;
  /** Scheduled publish date of the article. */
  publishAt?: InputMaybe<Scalars['DateTime']['input']>;
};

/** Enums for publishing state. */
export type PublishState =
  | 'error'
  | 'pending'
  | 'published'
  | 'unpublished';

export type PutAnnouncementInput = {
  channels?: InputMaybe<Array<AnnouncementChannelInput>>;
  content?: InputMaybe<Array<TranslationInput>>;
  cover?: InputMaybe<Scalars['String']['input']>;
  expiredAt?: InputMaybe<Scalars['DateTime']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  link?: InputMaybe<Array<TranslationInput>>;
  order?: InputMaybe<Scalars['Int']['input']>;
  title?: InputMaybe<Array<TranslationInput>>;
  type?: InputMaybe<AnnouncementType>;
  visible?: InputMaybe<Scalars['Boolean']['input']>;
};

export type PutArticleFederationSettingInput = {
  id: Scalars['ID']['input'];
  state: FederationArticleSettingState;
};

export type PutCircleArticlesInput = {
  /** Access Type, `public` or `paywall` only. */
  accessType: ArticleAccessType;
  /** Article Ids */
  articles?: InputMaybe<Array<Scalars['ID']['input']>>;
  /** Circle ID */
  id: Scalars['ID']['input'];
  license?: InputMaybe<ArticleLicenseType>;
  /** Action Type */
  type: PutCircleArticlesType;
};

export type PutCircleArticlesType =
  | 'add'
  | 'remove';

export type PutCircleInput = {
  /** Circle's subscription fee. */
  amount?: InputMaybe<Scalars['amount_Float_exclusiveMin_0']['input']>;
  /** Unique ID of a Circle's avatar. */
  avatar?: InputMaybe<Scalars['ID']['input']>;
  /** Unique ID of a Circle's cover. */
  cover?: InputMaybe<Scalars['ID']['input']>;
  /** A short description of this Circle. */
  description?: InputMaybe<Scalars['String']['input']>;
  /** Human readable name of this Circle. */
  displayName?: InputMaybe<Scalars['String']['input']>;
  /** Unique ID. */
  id?: InputMaybe<Scalars['ID']['input']>;
  /** Slugified name of a Circle. */
  name?: InputMaybe<Scalars['String']['input']>;
};

export type PutCollectionInput = {
  cover?: InputMaybe<Scalars['ID']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  pinned?: InputMaybe<Scalars['Boolean']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type PutCommentInput = {
  comment: CommentInput;
  id?: InputMaybe<Scalars['ID']['input']>;
};

export type PutCurationChannelInput = {
  activePeriod?: InputMaybe<DatetimeRangeInput>;
  color?: InputMaybe<Color>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Array<TranslationInput>>;
  navbarTitle?: InputMaybe<Array<TranslationInput>>;
  note?: InputMaybe<Array<TranslationInput>>;
  pinAmount?: InputMaybe<Scalars['Int']['input']>;
  showRecommendation?: InputMaybe<Scalars['Boolean']['input']>;
  state?: InputMaybe<CurationChannelState>;
};

export type PutDraftInput = {
  accessType?: InputMaybe<ArticleAccessType>;
  /** Which campaigns to attach */
  campaigns?: InputMaybe<Array<ArticleCampaignInput>>;
  /** Whether readers can comment */
  canComment?: InputMaybe<Scalars['Boolean']['input']>;
  circle?: InputMaybe<Scalars['ID']['input']>;
  /** Deprecated, use connections instead */
  collection?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  /** Add article to these collections when published */
  collections?: InputMaybe<Array<Scalars['ID']['input']>>;
  connections?: InputMaybe<Array<Scalars['ID']['input']>>;
  content?: InputMaybe<Scalars['String']['input']>;
  cover?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  indentFirstLine?: InputMaybe<Scalars['Boolean']['input']>;
  /** Whether publish to ISCN */
  iscnPublish?: InputMaybe<Scalars['Boolean']['input']>;
  /** Last known update timestamp for version conflict detection */
  lastUpdatedAt?: InputMaybe<Scalars['DateTime']['input']>;
  license?: InputMaybe<ArticleLicenseType>;
  replyToDonator?: InputMaybe<Scalars['replyToDonator_String_maxLength_140']['input']>;
  requestForDonation?: InputMaybe<Scalars['requestForDonation_String_maxLength_140']['input']>;
  sensitive?: InputMaybe<Scalars['Boolean']['input']>;
  summary?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type PutIcymiTopicInput = {
  articles?: InputMaybe<Array<Scalars['ID']['input']>>;
  id?: InputMaybe<Scalars['ID']['input']>;
  note?: InputMaybe<Array<TranslationInput>>;
  pinAmount?: InputMaybe<Scalars['Int']['input']>;
  state?: InputMaybe<IcymiTopicState>;
  title?: InputMaybe<Array<TranslationInput>>;
};

export type PutMomentInput = {
  articles?: InputMaybe<Array<Scalars['ID']['input']>>;
  assets?: InputMaybe<Array<Scalars['ID']['input']>>;
  content: Scalars['String']['input'];
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type PutOAuthClientInput = {
  avatar?: InputMaybe<Scalars['ID']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  grantTypes?: InputMaybe<Array<GrantType>>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  redirectURIs?: InputMaybe<Array<Scalars['String']['input']>>;
  scope?: InputMaybe<Array<Scalars['String']['input']>>;
  secret?: InputMaybe<Scalars['String']['input']>;
  user?: InputMaybe<Scalars['ID']['input']>;
  website?: InputMaybe<Scalars['website_String_format_uri']['input']>;
};

export type PutRemarkInput = {
  id: Scalars['ID']['input'];
  remark: Scalars['String']['input'];
  type: RemarkTypes;
};

export type PutRestrictedUsersInput = {
  ids: Array<Scalars['ID']['input']>;
  restrictions: Array<UserRestrictionType>;
};

export type PutSkippedListItemInput = {
  archived?: InputMaybe<Scalars['Boolean']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  type?: InputMaybe<SkippedListItemType>;
  value?: InputMaybe<Scalars['String']['input']>;
};

export type PutTagChannelInput = {
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id: Scalars['ID']['input'];
  navbarTitle?: InputMaybe<Array<TranslationInput>>;
};

export type PutTopicChannelInput = {
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Array<TranslationInput>>;
  navbarTitle?: InputMaybe<Array<TranslationInput>>;
  note?: InputMaybe<Array<TranslationInput>>;
  providerId?: InputMaybe<Scalars['String']['input']>;
  subChannels?: InputMaybe<Array<Scalars['ID']['input']>>;
};

export type PutUserFeatureFlagsInput = {
  flags: Array<UserFeatureFlagType>;
  ids: Array<Scalars['ID']['input']>;
};

export type PutUserFederationSettingInput = {
  id: Scalars['ID']['input'];
  state: FederationAuthorSettingState;
};

export type PutWritingChallengeInput = {
  announcements?: InputMaybe<Array<Scalars['ID']['input']>>;
  applicationPeriod?: InputMaybe<DatetimeRangeInput>;
  channelEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  cover?: InputMaybe<Scalars['ID']['input']>;
  description?: InputMaybe<Array<TranslationInput>>;
  /** exclude articles of this campaign in topic channels and newest */
  exclusive?: InputMaybe<Scalars['Boolean']['input']>;
  featuredDescription?: InputMaybe<Array<TranslationInput>>;
  id?: InputMaybe<Scalars['ID']['input']>;
  link?: InputMaybe<Scalars['String']['input']>;
  managers?: InputMaybe<Array<Scalars['ID']['input']>>;
  name?: InputMaybe<Array<TranslationInput>>;
  navbarTitle?: InputMaybe<Array<TranslationInput>>;
  newStages?: InputMaybe<Array<CampaignStageInput>>;
  organizers?: InputMaybe<Array<Scalars['ID']['input']>>;
  showAd?: InputMaybe<Scalars['Boolean']['input']>;
  showOther?: InputMaybe<Scalars['Boolean']['input']>;
  stages?: InputMaybe<Array<CampaignStageInput>>;
  state?: InputMaybe<CampaignState>;
  writingPeriod?: InputMaybe<DatetimeRangeInput>;
};

export type Query = {
  article?: Maybe<Article>;
  campaign?: Maybe<Campaign>;
  campaignOrganizers: UserConnection;
  campaigns: CampaignConnection;
  channel?: Maybe<Channel>;
  channels: Array<Channel>;
  circle?: Maybe<Circle>;
  /** One public Community Watch audit record. */
  communityWatchAction?: Maybe<CommunityWatchAction>;
  /** Recent public Community Watch audit records. */
  communityWatchActions: CommunityWatchActionConnection;
  exchangeRates?: Maybe<Array<ExchangeRate>>;
  frequentSearch?: Maybe<Array<Scalars['String']['output']>>;
  moment?: Maybe<Moment>;
  node?: Maybe<Node>;
  nodes?: Maybe<Array<Node>>;
  oauthClient?: Maybe<OAuthClient>;
  oauthRequestToken?: Maybe<Scalars['String']['output']>;
  official: Official;
  oss: Oss;
  search: SearchResultConnection;
  user?: Maybe<User>;
  viewer?: Maybe<User>;
};


export type QueryArticleArgs = {
  input: ArticleInput;
};


export type QueryCampaignArgs = {
  input: CampaignInput;
};


export type QueryCampaignOrganizersArgs = {
  input: ConnectionArgs;
};


export type QueryCampaignsArgs = {
  input: CampaignsInput;
};


export type QueryChannelArgs = {
  input: ChannelInput;
};


export type QueryChannelsArgs = {
  input?: InputMaybe<ChannelsInput>;
};


export type QueryCircleArgs = {
  input: CircleInput;
};


export type QueryCommunityWatchActionArgs = {
  input: CommunityWatchActionInput;
};


export type QueryCommunityWatchActionsArgs = {
  input: CommunityWatchActionsInput;
};


export type QueryExchangeRatesArgs = {
  input?: InputMaybe<ExchangeRatesInput>;
};


export type QueryFrequentSearchArgs = {
  input: FrequentSearchInput;
};


export type QueryMomentArgs = {
  input: MomentInput;
};


export type QueryNodeArgs = {
  input: NodeInput;
};


export type QueryNodesArgs = {
  input: NodesInput;
};


export type QueryOauthClientArgs = {
  input: OAuthClientInput;
};


export type QuerySearchArgs = {
  input: SearchInput;
};


export type QueryUserArgs = {
  input: UserInput;
};

export type QuoteCurrency =
  | 'HKD'
  | 'TWD'
  | 'USD';

export type ReadArticleInput = {
  id: Scalars['ID']['input'];
};

export type ReadHistory = {
  article: Article;
  readAt: Scalars['DateTime']['output'];
};

export type ReadHistoryConnection = Connection & {
  edges?: Maybe<Array<ReadHistoryEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type ReadHistoryEdge = {
  cursor: Scalars['String']['output'];
  node: ReadHistory;
};

export type RecentSearchConnection = Connection & {
  edges?: Maybe<Array<RecentSearchEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type RecentSearchEdge = {
  cursor: Scalars['String']['output'];
  node: Scalars['String']['output'];
};

export type RecommendFilterInput = {
  channel?: InputMaybe<IdentityInput>;
  /** filter out followed users */
  followed?: InputMaybe<Scalars['Boolean']['input']>;
  /** index of list, min: 0, max: 49 */
  random?: InputMaybe<Scalars['random_Int_min_0_max_49']['input']>;
};

export type RecommendInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<RecommendFilterInput>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  newAlgo?: InputMaybe<Scalars['Boolean']['input']>;
  oss?: InputMaybe<Scalars['Boolean']['input']>;
};

/** Enums for types of recommend articles. */
export type RecommendTypes =
  | 'hottest'
  | 'icymi'
  | 'newest'
  | 'search';

export type Recommendation = {
  /** Global user list, sort by activities in recent 6 month. */
  authors: UserConnection;
  /** Activities based on user's following, sort by creation time. */
  following: FollowingActivityConnection;
  /** Global articles sort by latest activity time. */
  hottest: ArticleConnection;
  hottestMoments: MomentConnection;
  /** 'In case you missed it' recommendation. */
  icymi: ArticleConnection;
  /** 'In case you missed it' topic. */
  icymiTopic?: Maybe<IcymiTopic>;
  /** Global articles sort by publish time. */
  newest: ArticleConnection;
  /** Global tag list, sort by activities in recent 14 days. */
  tags: TagConnection;
};


export type RecommendationAuthorsArgs = {
  input: RecommendInput;
};


export type RecommendationFollowingArgs = {
  input: RecommendationFollowingInput;
};


export type RecommendationHottestArgs = {
  input: RecommendInput;
};


export type RecommendationHottestMomentsArgs = {
  input: RecommendInput;
};


export type RecommendationIcymiArgs = {
  input: ConnectionArgs;
};


export type RecommendationNewestArgs = {
  input: RecommendationNewestInput;
};


export type RecommendationTagsArgs = {
  input: RecommendInput;
};

export type RecommendationFollowingFilterInput = {
  type?: InputMaybe<RecommendationFollowingFilterType>;
};

export type RecommendationFollowingFilterType =
  | 'article';

export type RecommendationFollowingInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<RecommendationFollowingFilterInput>;
  first?: InputMaybe<Scalars['Int']['input']>;
};

export type RecommendationNewestInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  excludeChannelArticles?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<FilterInput>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  oss?: InputMaybe<Scalars['Boolean']['input']>;
};

export type RefreshIpnsFeedInput = {
  /** refresh how many recent articles, default to 50 */
  numArticles?: InputMaybe<Scalars['Int']['input']>;
  userName: Scalars['String']['input'];
};

export type RelatedDonationArticlesInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  oss?: InputMaybe<Scalars['Boolean']['input']>;
  /** index of article list, min: 0, max: 49 */
  random?: InputMaybe<Scalars['random_Int_min_0_max_49']['input']>;
};

export type RemarkTypes =
  | 'Article'
  | 'Comment'
  | 'Feedback'
  | 'Report'
  | 'Tag'
  | 'User';

export type RemoveSocialLoginInput = {
  type: SocialAccountType;
};

export type RenameTagInput = {
  content: Scalars['String']['input'];
  id: Scalars['ID']['input'];
};

export type ReorderChannelsInput = {
  ids: Array<Scalars['ID']['input']>;
};

export type ReorderCollectionArticlesInput = {
  collection: Scalars['ID']['input'];
  moves: Array<ReorderMoveInput>;
};

export type ReorderMoveInput = {
  item: Scalars['ID']['input'];
  /** The new position move to. To move item to the beginning of the list, set to 0. To the end of the list, set to the length of the list - 1. */
  newPosition: Scalars['Int']['input'];
};

export type Report = Node & {
  /** The audit record when this report originates from a community watch action. */
  communityWatchAction?: Maybe<CommunityWatchAction>;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  reason: ReportReason;
  reporter: User;
  /** Whether this record originates from a direct in-site report or a community watch action. */
  source: ReportSource;
  target: Node;
};

export type ReportConnection = Connection & {
  edges?: Maybe<Array<ReportEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type ReportEdge = {
  cursor: Scalars['String']['output'];
  node: Report;
};

export type ReportReason =
  /** Pornographic/adult advertising flagged by a community watch member. */
  | 'community_watch_porn_ad'
  /** Spam advertising flagged by a community watch member. */
  | 'community_watch_spam_ad'
  | 'discrimination_insult_hatred'
  | 'illegal_advertising'
  | 'other'
  | 'pornography_involving_minors'
  | 'tort';

export type ReportSource =
  /** Created automatically when a community watch member removes a comment. */
  | 'community_watch'
  /** Submitted directly via the in-site report form. */
  | 'direct';

export type ResetLikerIdInput = {
  id: Scalars['ID']['input'];
};

export type ResetPasswordInput = {
  codeId: Scalars['ID']['input'];
  password: Scalars['String']['input'];
  type?: InputMaybe<ResetPasswordType>;
};

export type ResetPasswordType =
  | 'account'
  | 'payment';

export type Response = Article | Comment;

export type ResponseConnection = Connection & {
  edges?: Maybe<Array<ResponseEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type ResponseEdge = {
  cursor: Scalars['String']['output'];
  node: Response;
};

/** Enums for sorting responses. */
export type ResponseSort =
  | 'newest'
  | 'oldest';

export type ResponsesInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  articleOnly?: InputMaybe<Scalars['Boolean']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  includeAfter?: InputMaybe<Scalars['Boolean']['input']>;
  includeBefore?: InputMaybe<Scalars['Boolean']['input']>;
  sort?: InputMaybe<ResponseSort>;
};

export type RestoreCommunityWatchCommentInput = {
  note?: InputMaybe<Scalars['String']['input']>;
  uuid: Scalars['ID']['input'];
};

export type ReviewTopicChannelFeedbackInput = {
  action: TopicChannelFeedbackAction;
  feedback: Scalars['ID']['input'];
};

/** Enums for user roles. */
export type Role =
  | 'admin'
  | 'user'
  | 'vistor';

export type SearchApiVersion =
  | 'v20230301'
  | 'v20230601';

export type SearchExclude =
  | 'blocked';

export type SearchFilter = {
  authorId?: InputMaybe<Scalars['ID']['input']>;
};

export type SearchInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  /** specific condition for rule data out */
  exclude?: InputMaybe<SearchExclude>;
  /** extra query filter for searching */
  filter?: InputMaybe<SearchFilter>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  /** should include tags used by author */
  includeAuthorTags?: InputMaybe<Scalars['Boolean']['input']>;
  /** search keyword */
  key: Scalars['String']['input'];
  oss?: InputMaybe<Scalars['Boolean']['input']>;
  quicksearch?: InputMaybe<Scalars['Boolean']['input']>;
  /** whether this search operation should be recorded in search history */
  record?: InputMaybe<Scalars['Boolean']['input']>;
  /** types of search target */
  type: SearchTypes;
};

export type SearchResultConnection = Connection & {
  edges?: Maybe<Array<SearchResultEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type SearchResultEdge = {
  cursor: Scalars['String']['output'];
  node: Node;
};

export type SearchTypes =
  | 'Article'
  | 'Tag'
  | 'User';

export type SendCampaignAnnouncementInput = {
  announcement: Array<TranslationInput>;
  campaign: Scalars['ID']['input'];
  link: Scalars['link_String_NotNull_format_uri']['input'];
  password: Scalars['String']['input'];
};

export type SendVerificationCodeInput = {
  email: Scalars['email_String_NotNull_format_email']['input'];
  /** email content language */
  language?: InputMaybe<UserLanguage>;
  /**
   * Redirect URL embedded in the verification email,
   * use code instead if not provided.
   */
  redirectUrl?: InputMaybe<Scalars['redirectUrl_String_format_uri']['input']>;
  token?: InputMaybe<Scalars['String']['input']>;
  type: VerificationCodeType;
};

export type SetAdStatusInput = {
  id: Scalars['ID']['input'];
  isAd: Scalars['Boolean']['input'];
};

export type SetArticleFederationSettingInput = {
  id: Scalars['ID']['input'];
  state: FederationArticleSettingState;
};

export type SetArticleTopicChannelsInput = {
  channels: Array<Scalars['ID']['input']>;
  id: Scalars['ID']['input'];
};

export type SetBoostInput = {
  boost: Scalars['boost_Float_NotNull_min_0']['input'];
  id: Scalars['ID']['input'];
  type: BoostTypes;
};

export type SetCurrencyInput = {
  currency?: InputMaybe<QuoteCurrency>;
};

export type SetEmailInput = {
  email: Scalars['String']['input'];
};

export type SetFeatureInput = {
  flag: FeatureFlag;
  name: FeatureName;
  value?: InputMaybe<Scalars['Float']['input']>;
};

export type SetPasswordInput = {
  password: Scalars['String']['input'];
};

export type SetSpamStatusInput = {
  id: Scalars['ID']['input'];
  isSpam: Scalars['Boolean']['input'];
};

export type SetUserNameInput = {
  userName: Scalars['String']['input'];
};

export type SetViewerFederationSettingInput = {
  state: FederationAuthorSettingState;
};

export type SigningMessagePurpose =
  | 'airdrop'
  | 'claimLogbook'
  | 'connect'
  | 'login'
  | 'signup';

export type SigningMessageResult = {
  createdAt: Scalars['DateTime']['output'];
  expiredAt: Scalars['DateTime']['output'];
  nonce: Scalars['String']['output'];
  purpose: SigningMessagePurpose;
  signingMessage: Scalars['String']['output'];
};

export type SingleFileUploadInput = {
  draft?: InputMaybe<Scalars['Boolean']['input']>;
  entityId?: InputMaybe<Scalars['ID']['input']>;
  entityType: EntityType;
  file?: InputMaybe<Scalars['Upload']['input']>;
  type: AssetType;
  url?: InputMaybe<Scalars['url_String_format_uri']['input']>;
};

export type SkippedListItem = {
  archived: Scalars['Boolean']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  type: SkippedListItemType;
  updatedAt: Scalars['DateTime']['output'];
  uuid: Scalars['ID']['output'];
  value: Scalars['String']['output'];
};

export type SkippedListItemEdge = {
  cursor: Scalars['String']['output'];
  node?: Maybe<SkippedListItem>;
};

export type SkippedListItemType =
  | 'agent_hash'
  | 'domain'
  | 'email';

export type SkippedListItemsConnection = Connection & {
  edges?: Maybe<Array<SkippedListItemEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type SkippedListItemsInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  type?: InputMaybe<SkippedListItemType>;
};

export type SocialAccount = {
  email?: Maybe<Scalars['String']['output']>;
  type: SocialAccountType;
  userName?: Maybe<Scalars['String']['output']>;
};

export type SocialAccountType =
  | 'Facebook'
  | 'Google'
  | 'Threads'
  | 'Twitter';

export type SocialLoginInput = {
  authorizationCode?: InputMaybe<Scalars['String']['input']>;
  /** OAuth2 PKCE code_verifier for Facebook and Twitter */
  codeVerifier?: InputMaybe<Scalars['String']['input']>;
  /** used in register */
  language?: InputMaybe<UserLanguage>;
  /** OIDC nonce for Google */
  nonce?: InputMaybe<Scalars['String']['input']>;
  /** oauth token/verifier in OAuth1.0a for Twitter */
  oauth1Credential?: InputMaybe<Oauth1CredentialInput>;
  referralCode?: InputMaybe<Scalars['String']['input']>;
  type: SocialAccountType;
};

export type SpamStatus = {
  /** Whether this work is labeled as spam by human, null for not labeled yet.  */
  isSpam?: Maybe<Scalars['Boolean']['output']>;
  /** Spam confident score by machine, null for not checked yet.  */
  score?: Maybe<Scalars['Float']['output']>;
};

export type StripeAccount = {
  id: Scalars['ID']['output'];
  loginUrl: Scalars['String']['output'];
};

export type StripeAccountCountry =
  | 'Australia'
  | 'Austria'
  | 'Belgium'
  | 'Bulgaria'
  | 'Canada'
  | 'Cyprus'
  | 'Denmark'
  | 'Estonia'
  | 'Finland'
  | 'France'
  | 'Germany'
  | 'Greece'
  | 'HongKong'
  | 'Ireland'
  | 'Italy'
  | 'Latvia'
  | 'Lithuania'
  | 'Luxembourg'
  | 'Malta'
  | 'Netherlands'
  | 'NewZealand'
  | 'Norway'
  | 'Poland'
  | 'Portugal'
  | 'Romania'
  | 'Singapore'
  | 'Slovakia'
  | 'Slovenia'
  | 'Spain'
  | 'Sweden'
  | 'UnitedKingdom'
  | 'UnitedStates';

export type SubmitReportInput = {
  reason: ReportReason;
  targetId: Scalars['ID']['input'];
};

export type SubmitTopicChannelFeedbackInput = {
  article: Scalars['ID']['input'];
  channels?: InputMaybe<Array<Scalars['ID']['input']>>;
  type: TopicChannelFeedbackType;
};

export type SubscribeCircleInput = {
  /** Unique ID. */
  id: Scalars['ID']['input'];
  /** Wallet password. */
  password?: InputMaybe<Scalars['String']['input']>;
};

export type SubscribeCircleResult = {
  circle: Circle;
  /** client secret for SetupIntent. */
  client_secret?: Maybe<Scalars['String']['output']>;
};

/** This type contains content, count and related data of an article tag. */
export type Tag = Channel & Node & {
  /** List of articles were attached with this tag. */
  articles: ChannelArticleConnection;
  /** Whether this tag is enabled as a channel */
  channelEnabled: Scalars['Boolean']['output'];
  /** Content of this tag. */
  content: Scalars['String']['output'];
  /** Time of this tag was created. */
  createdAt: Scalars['DateTime']['output'];
  deleted: Scalars['Boolean']['output'];
  /** Unique id of this tag. */
  id: Scalars['ID']['output'];
  /** This value determines if current viewer is following or not. */
  isFollower?: Maybe<Scalars['Boolean']['output']>;
  /** Navbar title for this tag channel */
  navbarTitle: Scalars['String']['output'];
  /** Counts of this tag. */
  numArticles: Scalars['Int']['output'];
  numAuthors: Scalars['Int']['output'];
  numMoments: Scalars['Int']['output'];
  oss: TagOss;
  /** Tags recommended based on relations to current tag. */
  recommended: TagConnection;
  /** Authors recommended based on relations to current tag. */
  recommendedAuthors: UserConnection;
  remark?: Maybe<Scalars['String']['output']>;
  /** Short hash for shorter url addressing */
  shortHash: Scalars['String']['output'];
  /** Articles and moments were attached with this tag. */
  writings: TagWritingConnection;
};


/** This type contains content, count and related data of an article tag. */
export type TagArticlesArgs = {
  input: TagArticlesInput;
};


/** This type contains content, count and related data of an article tag. */
export type TagNavbarTitleArgs = {
  input?: InputMaybe<TranslationArgs>;
};


/** This type contains content, count and related data of an article tag. */
export type TagRecommendedArgs = {
  input: RecommendInput;
};


/** This type contains content, count and related data of an article tag. */
export type TagRecommendedAuthorsArgs = {
  input: ConnectionArgs;
};


/** This type contains content, count and related data of an article tag. */
export type TagWritingsArgs = {
  input: WritingInput;
};

export type TagArticlesInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  oss?: InputMaybe<Scalars['Boolean']['input']>;
  sortBy?: InputMaybe<TagArticlesSortBy>;
};

export type TagArticlesSortBy =
  | 'byCreatedAtDesc'
  | 'byHottestDesc';

export type TagConnection = Connection & {
  edges?: Maybe<Array<TagEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type TagEdge = {
  cursor: Scalars['String']['output'];
  node: Tag;
};

export type TagOss = {
  boost: Scalars['Float']['output'];
  score: Scalars['Float']['output'];
};

export type TagWritingConnection = Connection & {
  edges?: Maybe<Array<TagWritingEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type TagWritingEdge = {
  cursor: Scalars['String']['output'];
  node: Writing;
  pinned: Scalars['Boolean']['output'];
};

export type TagsInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  sort?: InputMaybe<TagsSort>;
};

/** Enums for sorting tags. */
export type TagsSort =
  | 'hottest'
  | 'newest'
  | 'oldest';

export type ToggleCircleMemberInput = {
  /** Toggle value. */
  enabled: Scalars['Boolean']['input'];
  /** Unique ID. */
  id: Scalars['ID']['input'];
  /** Unique ID of target user. */
  targetId: Scalars['ID']['input'];
};

/** Common input to toggle single item for `toggleXXX` mutations */
export type ToggleItemInput = {
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id: Scalars['ID']['input'];
};

export type TogglePinChannelArticlesInput = {
  articles: Array<Scalars['ID']['input']>;
  /** id of TopicChannel or CurationChannel */
  channels: Array<Scalars['ID']['input']>;
  pinned: Scalars['Boolean']['input'];
};

export type ToggleRecommendInput = {
  enabled: Scalars['Boolean']['input'];
  id: Scalars['ID']['input'];
  type?: InputMaybe<RecommendTypes>;
};

export type ToggleSeedingUsersInput = {
  enabled: Scalars['Boolean']['input'];
  ids?: InputMaybe<Array<Scalars['ID']['input']>>;
};

export type ToggleUsersBadgeInput = {
  enabled: Scalars['Boolean']['input'];
  ids: Array<Scalars['ID']['input']>;
  type: BadgeType;
};

export type ToggleWritingChallengeFeaturedArticlesInput = {
  articles: Array<Scalars['ID']['input']>;
  campaign: Scalars['ID']['input'];
  enabled: Scalars['Boolean']['input'];
};

export type TopDonatorConnection = Connection & {
  edges?: Maybe<Array<TopDonatorEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type TopDonatorEdge = {
  cursor: Scalars['String']['output'];
  donationCount: Scalars['Int']['output'];
  node: Donator;
};

export type TopDonatorFilter = {
  inRangeEnd?: InputMaybe<Scalars['DateTime']['input']>;
  inRangeStart?: InputMaybe<Scalars['DateTime']['input']>;
};

export type TopDonatorInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<TopDonatorFilter>;
  first?: InputMaybe<Scalars['Int']['input']>;
};

export type TopicChannel = Channel & Node & {
  articles: ChannelArticleConnection;
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  navbarTitle: Scalars['String']['output'];
  note?: Maybe<Scalars['String']['output']>;
  parent?: Maybe<TopicChannel>;
  providerId?: Maybe<Scalars['String']['output']>;
  shortHash: Scalars['String']['output'];
};


export type TopicChannelArticlesArgs = {
  input: ChannelArticlesInput;
};


export type TopicChannelNameArgs = {
  input?: InputMaybe<TranslationArgs>;
};


export type TopicChannelNavbarTitleArgs = {
  input?: InputMaybe<TranslationArgs>;
};


export type TopicChannelNoteArgs = {
  input?: InputMaybe<TranslationArgs>;
};

export type TopicChannelClassification = {
  /** Which channels this article is in, null for not classified, empty for not in any channel */
  channels?: Maybe<Array<ArticleTopicChannel>>;
  /** whether user enable channel classification */
  enabled: Scalars['Boolean']['output'];
  /** Feedback from author */
  feedback?: Maybe<TopicChannelFeedback>;
};

export type TopicChannelFeedback = {
  article: Article;
  /** Which channels author want to be in, empty for no channels */
  channels?: Maybe<Array<TopicChannel>>;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  state?: Maybe<TopicChannelFeedbackState>;
  type: TopicChannelFeedbackType;
};

export type TopicChannelFeedbackAction =
  | 'accept'
  | 'reject';

export type TopicChannelFeedbackConnection = Connection & {
  edges: Array<TopicChannelFeedbackEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type TopicChannelFeedbackEdge = {
  cursor: Scalars['String']['output'];
  node: TopicChannelFeedback;
};

export type TopicChannelFeedbackState =
  | 'accepted'
  | 'pending'
  | 'rejected'
  | 'resolved';

export type TopicChannelFeedbackType =
  | 'negative'
  | 'positive';

export type TopicChannelFeedbacksFilterInput = {
  spam?: InputMaybe<Scalars['Boolean']['input']>;
  state?: InputMaybe<TopicChannelFeedbackState>;
  type?: InputMaybe<TopicChannelFeedbackType>;
};

export type TopicChannelFeedbacksInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<TopicChannelFeedbacksFilterInput>;
  first: Scalars['first_Int_NotNull_min_0']['input'];
};

export type Transaction = {
  amount: Scalars['Float']['output'];
  /** blockchain transaction info of ERC20/native token payment transaction */
  blockchainTx?: Maybe<BlockchainTransaction>;
  /** Timestamp of transaction. */
  createdAt: Scalars['DateTime']['output'];
  currency: TransactionCurrency;
  fee: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  /** Message for end user, including reason of failure. */
  message?: Maybe<Scalars['String']['output']>;
  purpose: TransactionPurpose;
  /** Recipient of transaction. */
  recipient?: Maybe<User>;
  /** Sender of transaction. */
  sender?: Maybe<User>;
  state: TransactionState;
  /** Related target article or transaction. */
  target?: Maybe<TransactionTarget>;
};

export type TransactionConnection = Connection & {
  edges?: Maybe<Array<TransactionEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type TransactionCurrency =
  | 'HKD'
  | 'LIKE'
  | 'USDT';

export type TransactionEdge = {
  cursor: Scalars['String']['output'];
  node: Transaction;
};

export type TransactionNotice = Notice & {
  /** List of notice actors. */
  actors?: Maybe<Array<User>>;
  /** Time of this notice was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Unique ID of this notice. */
  id: Scalars['ID']['output'];
  target: Transaction;
  type: TransactionNoticeType;
  /** The value determines if the notice is unread or not. */
  unread: Scalars['Boolean']['output'];
};

export type TransactionNoticeType =
  | 'PaymentReceivedDonation'
  | 'WithdrewLockedTokens';

export type TransactionPurpose =
  | 'addCredit'
  | 'curationVaultWithdrawal'
  | 'dispute'
  | 'donation'
  | 'payout'
  | 'payoutReversal'
  | 'refund'
  | 'subscriptionSplit';

export type TransactionState =
  | 'canceled'
  | 'failed'
  | 'pending'
  | 'succeeded';

export type TransactionTarget = Article | Circle | Transaction;

export type TransactionsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<TransactionsFilter>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  /** deprecated, use TransactionsFilter.id instead. */
  id?: InputMaybe<Scalars['ID']['input']>;
  /** deprecated, use TransactionsFilter.states instead. */
  states?: InputMaybe<Array<TransactionState>>;
};

export type TransactionsFilter = {
  currency?: InputMaybe<TransactionCurrency>;
  id?: InputMaybe<Scalars['ID']['input']>;
  purpose?: InputMaybe<TransactionPurpose>;
  states?: InputMaybe<Array<TransactionState>>;
};

export type TransactionsReceivedByArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  purpose: TransactionPurpose;
  senderId?: InputMaybe<Scalars['ID']['input']>;
};

export type TranslatedAnnouncement = {
  content?: Maybe<Scalars['String']['output']>;
  cover?: Maybe<Scalars['String']['output']>;
  language: UserLanguage;
  link?: Maybe<Scalars['link_String_format_uri']['output']>;
  title?: Maybe<Scalars['String']['output']>;
};

export type TranslationArgs = {
  language: UserLanguage;
};

export type TranslationInput = {
  language: UserLanguage;
  text: Scalars['String']['input'];
};

export type TranslationModel =
  | 'google_gemini_2_0_flash'
  | 'google_gemini_2_5_flash'
  | 'google_translation_v2'
  | 'opencc';

export type UnbindLikerIdInput = {
  id: Scalars['ID']['input'];
  likerId: Scalars['String']['input'];
};

export type UnlikeCollectionInput = {
  id: Scalars['ID']['input'];
};

export type UnlikeMomentInput = {
  id: Scalars['ID']['input'];
};

export type UnpinCommentInput = {
  id: Scalars['ID']['input'];
};

export type UnsubscribeCircleInput = {
  /** Unique ID. */
  id: Scalars['ID']['input'];
};

export type UnvoteCommentInput = {
  id: Scalars['ID']['input'];
};

export type UpdateArticleSensitiveInput = {
  id: Scalars['ID']['input'];
  sensitive: Scalars['Boolean']['input'];
};

export type UpdateArticleStateInput = {
  id: Scalars['ID']['input'];
  state: ArticleState;
};

export type UpdateCampaignApplicationStateInput = {
  campaign: Scalars['ID']['input'];
  state: CampaignApplicationState;
  user: Scalars['ID']['input'];
};

export type UpdateCommentsStateInput = {
  ids: Array<Scalars['ID']['input']>;
  state: CommentState;
};

export type UpdateCommunityWatchActionStateInput = {
  appealState?: InputMaybe<CommunityWatchAppealState>;
  note?: InputMaybe<Scalars['String']['input']>;
  reason?: InputMaybe<CommunityWatchRemoveCommentReason>;
  reviewState?: InputMaybe<CommunityWatchReviewState>;
  uuid: Scalars['ID']['input'];
};

export type UpdateMomentFeedApplicationStateInput = {
  id: Scalars['ID']['input'];
  state: MomentFeedUserState;
};

export type UpdateNotificationSettingInput = {
  enabled: Scalars['Boolean']['input'];
  type: NotificationSettingType;
};

export type UpdateUserExtraInput = {
  id: Scalars['ID']['input'];
  referralCode?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateUserInfoInput = {
  agreeOn?: InputMaybe<Scalars['Boolean']['input']>;
  avatar?: InputMaybe<Scalars['ID']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  displayName?: InputMaybe<Scalars['String']['input']>;
  language?: InputMaybe<UserLanguage>;
  paymentPassword?: InputMaybe<Scalars['String']['input']>;
  paymentPointer?: InputMaybe<Scalars['String']['input']>;
  profileCover?: InputMaybe<Scalars['ID']['input']>;
  referralCode?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateUserRoleInput = {
  id: Scalars['ID']['input'];
  role: UserRole;
};

export type UpdateUserStateInput = {
  banDays?: InputMaybe<Scalars['banDays_Int_exclusiveMin_0']['input']>;
  emails?: InputMaybe<Array<Scalars['String']['input']>>;
  id?: InputMaybe<Scalars['ID']['input']>;
  password?: InputMaybe<Scalars['String']['input']>;
  state: UserState;
};

export type User = Node & {
  /** Record of user activity, only accessable by current user. */
  activity: UserActivity;
  /** user data analytics, only accessable by current user. */
  analytics: UserAnalytics;
  /** Articles authored by current user. */
  articles: ArticleConnection;
  /** URL for user avatar. */
  avatar?: Maybe<Scalars['String']['output']>;
  /** Users that blocked by current user. */
  blockList: UserConnection;
  /** Artilces current user bookmarked. */
  bookmarkedArticles: ArticleConnection;
  /** Tags current user bookmarked. */
  bookmarkedTags: TagConnection;
  /** active applied campaigns */
  campaigns: CampaignConnection;
  /** collections authored by current user. */
  collections: CollectionConnection;
  /** Articles current user commented on */
  commentedArticles: ArticleConnection;
  /** Display name on user profile, can be duplicated. */
  displayName?: Maybe<Scalars['String']['output']>;
  /** Drafts authored by current user. */
  drafts: DraftConnection;
  /** Public-safe feature eligibility for current viewer. */
  features: UserFeatures;
  /** User-level federation opt-in setting. */
  federationSetting?: Maybe<UserFederationSetting>;
  /** Followers of this user. */
  followers: UserConnection;
  /** Following contents of this user. */
  following: Following;
  /** Global id of an user. */
  id: Scalars['ID']['output'];
  /** User information. */
  info: UserInfo;
  /** Whether current user is blocked by viewer. */
  isBlocked: Scalars['Boolean']['output'];
  /** Whether current user is blocking viewer. */
  isBlocking: Scalars['Boolean']['output'];
  /** Whether viewer is following current user. */
  isFollowee: Scalars['Boolean']['output'];
  /** Whether current user is following viewer. */
  isFollower: Scalars['Boolean']['output'];
  isMomentFeedApplied: Scalars['Boolean']['output'];
  /** user latest articles or collections */
  latestWorks: Array<PinnableWork>;
  /** Liker info of current user */
  liker: Liker;
  /** LikerID of LikeCoin, being used by LikeCoin OAuth */
  likerId?: Maybe<Scalars['String']['output']>;
  notices: NoticeConnection;
  oss: UserOss;
  /** Circles belong to current user. */
  ownCircles?: Maybe<Array<Circle>>;
  /** Payment pointer that resolves to Open Payments endpoints */
  paymentPointer?: Maybe<Scalars['String']['output']>;
  /** user pinned articles or collections */
  pinnedWorks: Array<PinnableWork>;
  /** Recommendations for current user. */
  recommendation: Recommendation;
  remark?: Maybe<Scalars['String']['output']>;
  /** User settings. */
  settings: UserSettings;
  /** Status of current user. */
  status?: Maybe<UserStatus>;
  /** Circles whiches user has subscribed. */
  subscribedCircles: CircleConnection;
  /** Tags by usage order of current user. */
  tags: TagConnection;
  /** Global unique user name of a user. */
  userName?: Maybe<Scalars['String']['output']>;
  /** User Wallet */
  wallet: Wallet;
  /** Articles and moments authored by current user. */
  writings: WritingConnection;
};


export type UserArticlesArgs = {
  input: UserArticlesInput;
};


export type UserBlockListArgs = {
  input: ConnectionArgs;
};


export type UserBookmarkedArticlesArgs = {
  input: ConnectionArgs;
};


export type UserBookmarkedTagsArgs = {
  input: ConnectionArgs;
};


export type UserCampaignsArgs = {
  input: ConnectionArgs;
};


export type UserCollectionsArgs = {
  input: ConnectionArgs;
};


export type UserCommentedArticlesArgs = {
  input: ConnectionArgs;
};


export type UserDraftsArgs = {
  input: ConnectionArgs;
};


export type UserFollowersArgs = {
  input: ConnectionArgs;
};


export type UserNoticesArgs = {
  input: ConnectionArgs;
};


export type UserSubscribedCirclesArgs = {
  input: ConnectionArgs;
};


export type UserTagsArgs = {
  input: ConnectionArgs;
};


export type UserWritingsArgs = {
  input: WritingInput;
};

export type UserActivity = {
  /** Appreciations current user received. */
  appreciationsReceived: AppreciationConnection;
  /** Total number of appreciation current user received. */
  appreciationsReceivedTotal: Scalars['Int']['output'];
  /** Appreciations current user gave. */
  appreciationsSent: AppreciationConnection;
  /** Total number of appreciation current user gave. */
  appreciationsSentTotal: Scalars['Int']['output'];
  /** User reading history. */
  history: ReadHistoryConnection;
  /** User search history. */
  recentSearches: RecentSearchConnection;
};


export type UserActivityAppreciationsReceivedArgs = {
  input: ConnectionArgs;
};


export type UserActivityAppreciationsSentArgs = {
  input: ConnectionArgs;
};


export type UserActivityHistoryArgs = {
  input: ConnectionArgs;
};


export type UserActivityRecentSearchesArgs = {
  input: ConnectionArgs;
};

export type UserAddArticleTagActivity = {
  actor: User;
  createdAt: Scalars['DateTime']['output'];
  /** Article added to tag */
  node: Article;
  /** Tag added by article */
  target: Tag;
};

export type UserAnalytics = {
  /** Top donators of current user. */
  topDonators: TopDonatorConnection;
};


export type UserAnalyticsTopDonatorsArgs = {
  input: TopDonatorInput;
};

export type UserArticlesFilter = {
  state?: InputMaybe<ArticleState>;
};

export type UserArticlesInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<UserArticlesFilter>;
  first?: InputMaybe<Scalars['first_Int_min_0']['input']>;
  sort?: InputMaybe<UserArticlesSort>;
};

export type UserArticlesSort =
  | 'mostAppreciations'
  | 'mostComments'
  | 'mostDonations'
  | 'mostReaders'
  | 'newest';

export type UserBroadcastCircleActivity = {
  actor: User;
  createdAt: Scalars['DateTime']['output'];
  /** Comment broadcast by actor */
  node: Comment;
  /** Circle that comment belongs to */
  target: Circle;
};

export type UserConnection = Connection & {
  edges?: Maybe<Array<UserEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type UserCreateCircleActivity = {
  actor: User;
  createdAt: Scalars['DateTime']['output'];
  /** Circle created by actor */
  node: Circle;
};

export type UserEdge = {
  cursor: Scalars['String']['output'];
  node: User;
};

export type UserFeatureFlag = {
  createdAt: Scalars['DateTime']['output'];
  type: UserFeatureFlagType;
};

export type UserFeatureFlagType =
  | 'bypassSpamDetection'
  | 'communityWatch'
  | 'fediverseBeta'
  | 'readSpamStatus'
  | 'unlimitedArticleFetch';

export type UserFeatures = {
  /** Whether current viewer can use Community Watch controls. */
  communityWatch: Scalars['Boolean']['output'];
  /** Whether current viewer can access Fediverse beta controls. */
  fediverseBeta: Scalars['Boolean']['output'];
};

export type UserFederationSetting = {
  state: FederationAuthorSettingState;
  updatedBy?: Maybe<Scalars['ID']['output']>;
  userId: Scalars['ID']['output'];
};

export type UserGroup =
  | 'a'
  | 'b';

export type UserInfo = {
  /** Timestamp of user agreement. */
  agreeOn?: Maybe<Scalars['DateTime']['output']>;
  /** User badges. */
  badges?: Maybe<Array<Badge>>;
  /** Timestamp of registration. */
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  /** Connected wallet. */
  cryptoWallet?: Maybe<CryptoWallet>;
  /** User desciption. */
  description?: Maybe<Scalars['String']['output']>;
  /** User email. */
  email?: Maybe<Scalars['email_String_format_email']['output']>;
  /** Weather user email is verified. */
  emailVerified: Scalars['Boolean']['output'];
  /** Login address */
  ethAddress?: Maybe<Scalars['String']['output']>;
  /** saved tags for showing on profile page, API allows up to 100, front-end lock'ed at lower limit */
  featuredTags?: Maybe<Array<Tag>>;
  /** Type of group. */
  group: UserGroup;
  /** the ipnsKey (`ipfs.io/ipns/<ipnsKey>/...`) for feed.json / rss.xml / index */
  ipnsKey?: Maybe<Scalars['String']['output']>;
  isWalletAuth: Scalars['Boolean']['output'];
  /** Cover of profile page. */
  profileCover?: Maybe<Scalars['String']['output']>;
  /** User connected social accounts. */
  socialAccounts: Array<SocialAccount>;
  /** Is user name editable. */
  userNameEditable: Scalars['Boolean']['output'];
};

export type UserInfoFields =
  | 'agreeOn'
  | 'avatar'
  | 'description'
  | 'displayName'
  | 'email';

export type UserInput = {
  ethAddress?: InputMaybe<Scalars['String']['input']>;
  userName?: InputMaybe<Scalars['String']['input']>;
  /** used for case insensitive username search  */
  userNameCaseIgnore?: InputMaybe<Scalars['Boolean']['input']>;
};

export type UserLanguage =
  | 'en'
  | 'zh_hans'
  | 'zh_hant';

export type UserNotice = Notice & {
  /** List of notice actors. */
  actors?: Maybe<Array<User>>;
  /** Time of this notice was created. */
  createdAt: Scalars['DateTime']['output'];
  /** Unique ID of this notice. */
  id: Scalars['ID']['output'];
  target: User;
  type: UserNoticeType;
  /** The value determines if the notice is unread or not. */
  unread: Scalars['Boolean']['output'];
};

export type UserNoticeType =
  | 'MomentFeedApproved'
  | 'UserNewFollower';

export type UserOss = {
  boost: Scalars['Float']['output'];
  featureFlags: Array<UserFeatureFlag>;
  momentFeedApplication?: Maybe<MomentFeedApplication>;
  restrictions: Array<UserRestriction>;
  score: Scalars['Float']['output'];
};

export type UserPostMomentActivity = {
  actor: User;
  createdAt: Scalars['DateTime']['output'];
  /** Another 3 moments posted by actor */
  more: Array<Moment>;
  /** Moment posted by actor */
  node: Moment;
};

export type UserPublishArticleActivity = {
  actor: User;
  createdAt: Scalars['DateTime']['output'];
  /** Article published by actor */
  node: Article;
};

export type UserRecommendationActivity = {
  /** Recommended users */
  nodes?: Maybe<Array<User>>;
  /** The source type of recommendation */
  source?: Maybe<UserRecommendationActivitySource>;
};

export type UserRecommendationActivitySource =
  | 'UserFollowing';

export type UserRestriction = {
  createdAt: Scalars['DateTime']['output'];
  type: UserRestrictionType;
};

export type UserRestrictionType =
  | 'articleHottest'
  | 'articleNewest';

export type UserRole =
  | 'admin'
  | 'user';

export type UserSettings = {
  /** User currency preference. */
  currency: QuoteCurrency;
  /** User language setting. */
  language: UserLanguage;
  /** Notification settings. */
  notification?: Maybe<NotificationSetting>;
};

export type UserState =
  | 'active'
  | 'archived'
  | 'banned'
  | 'frozen';

export type UserStatus = {
  /** Number of articles published by user */
  articleCount: Scalars['Int']['output'];
  /** Number of chances for the user to change email in a nature day. Reset in UTC+8 0:00 */
  changeEmailTimesLeft: Scalars['Int']['output'];
  /** Number of comments posted by user. */
  commentCount: Scalars['Int']['output'];
  /** Number of articles donated by user */
  donatedArticleCount: Scalars['Int']['output'];
  /** Weather login password is set for email login. */
  hasEmailLoginPassword: Scalars['Boolean']['output'];
  /** Whether user already set payment password. */
  hasPaymentPassword: Scalars['Boolean']['output'];
  /** Number of moments posted by user */
  momentCount: Scalars['Int']['output'];
  /** Number of times of donations received by user */
  receivedDonationCount: Scalars['Int']['output'];
  /** User role and access level. */
  role: UserRole;
  /** User state. */
  state: UserState;
  /** Number of referred user registration count (in Digital Nomad Campaign). */
  totalReferredCount: Scalars['Int']['output'];
  /** Number of total written words. */
  totalWordCount: Scalars['Int']['output'];
  /** Whether there are unread activities from following. */
  unreadFollowing: Scalars['Boolean']['output'];
  /** Number of unread notices. */
  unreadNoticeCount: Scalars['Int']['output'];
};

export type VerificationCodeType =
  | 'email_otp'
  | 'email_verify'
  | 'payment_password_reset'
  | 'register';

export type VerifyEmailInput = {
  code: Scalars['String']['input'];
  email: Scalars['String']['input'];
};

/** Enums for vote types. */
export type Vote =
  | 'down'
  | 'up';

export type VoteCommentInput = {
  id: Scalars['ID']['input'];
  vote: Vote;
};

export type Wallet = {
  balance: Balance;
  /** The last four digits of the card. */
  cardLast4?: Maybe<Scalars['String']['output']>;
  /** URL of Stripe Dashboard to manage subscription invoice and payment method */
  customerPortal?: Maybe<Scalars['String']['output']>;
  /** Account of Stripe Connect to manage payout */
  stripeAccount?: Maybe<StripeAccount>;
  transactions: TransactionConnection;
};


export type WalletTransactionsArgs = {
  input: TransactionsArgs;
};

export type WalletLoginInput = {
  ethAddress: Scalars['String']['input'];
  /** used in register */
  language?: InputMaybe<UserLanguage>;
  /** nonce from generateSigningMessage */
  nonce: Scalars['String']['input'];
  referralCode?: InputMaybe<Scalars['String']['input']>;
  /** sign'ed by wallet */
  signature: Scalars['String']['input'];
  /** the message being sign'ed, including nonce */
  signedMessage: Scalars['String']['input'];
};

export type WithdrawLockedTokensResult = {
  transaction: Transaction;
};

export type Writing = Article | Comment | Moment;

export type WritingChallenge = Campaign & Channel & Node & {
  announcements: Array<Article>;
  application?: Maybe<CampaignApplication>;
  applicationPeriod?: Maybe<DatetimeRange>;
  articles: CampaignArticleConnection;
  channelEnabled: Scalars['Boolean']['output'];
  cover?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  featuredDescription: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  isManager: Scalars['Boolean']['output'];
  link: Scalars['String']['output'];
  name: Scalars['String']['output'];
  navbarTitle: Scalars['String']['output'];
  organizers: Array<User>;
  oss: CampaignOss;
  participants: CampaignParticipantConnection;
  shortHash: Scalars['String']['output'];
  showAd: Scalars['Boolean']['output'];
  showOther: Scalars['Boolean']['output'];
  stages: Array<CampaignStage>;
  state: CampaignState;
  writingPeriod?: Maybe<DatetimeRange>;
};


export type WritingChallengeArticlesArgs = {
  input: CampaignArticlesInput;
};


export type WritingChallengeDescriptionArgs = {
  input?: InputMaybe<TranslationArgs>;
};


export type WritingChallengeFeaturedDescriptionArgs = {
  input?: InputMaybe<TranslationArgs>;
};


export type WritingChallengeNameArgs = {
  input?: InputMaybe<TranslationArgs>;
};


export type WritingChallengeNavbarTitleArgs = {
  input?: InputMaybe<TranslationArgs>;
};


export type WritingChallengeParticipantsArgs = {
  input: CampaignParticipantsInput;
};

export type WritingConnection = Connection & {
  edges?: Maybe<Array<WritingEdge>>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type WritingEdge = {
  cursor: Scalars['String']['output'];
  node: Writing;
};

export type WritingInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
};

export type UserArticlesQueryVariables = Exact<{
  userName: Scalars['String']['input'];
  after?: InputMaybe<Scalars['String']['input']>;
}>;


export type UserArticlesQuery = { user?: { id: string, userName?: string | null | undefined, articles: { totalCount: number, pageInfo: { endCursor?: string | null | undefined, hasNextPage: boolean }, edges?: Array<{ node: { id: string, title: string, slug: string, shortHash: string, content: string, summary: string, language?: string | null | undefined, createdAt: any, revisedAt?: any | null | undefined, cover?: string | null | undefined, tags?: Array<{ id: string, content: string }> | null | undefined } }> | null | undefined } } | null | undefined };

export type UserCollectionsQueryVariables = Exact<{
  userName: Scalars['String']['input'];
  after?: InputMaybe<Scalars['String']['input']>;
}>;


export type UserCollectionsQuery = { user?: { id: string, collections: { totalCount: number, pageInfo: { endCursor?: string | null | undefined, hasNextPage: boolean }, edges?: Array<{ node: { id: string, title: string, description?: string | null | undefined, cover?: string | null | undefined, articles: { edges?: Array<{ node: { id: string, shortHash: string, title: string, slug: string } }> | null | undefined } } }> | null | undefined } } | null | undefined };

export type UserProfileQueryVariables = Exact<{
  userName: Scalars['String']['input'];
}>;


export type UserProfileQuery = { user?: { id: string, userName?: string | null | undefined, displayName?: string | null | undefined, avatar?: string | null | undefined, info: { description?: string | null | undefined, profileCover?: string | null | undefined }, settings: { language: UserLanguage } } | null | undefined };

export type ViewerArticlesQueryVariables = Exact<{
  after?: InputMaybe<Scalars['String']['input']>;
}>;


export type ViewerArticlesQuery = { viewer?: { id: string, userName?: string | null | undefined, articles: { totalCount: number, pageInfo: { endCursor?: string | null | undefined, hasNextPage: boolean }, edges?: Array<{ node: { id: string, title: string, slug: string, shortHash: string, content: string, summary: string, createdAt: any, revisedAt?: any | null | undefined, cover?: string | null | undefined, tags?: Array<{ id: string, content: string }> | null | undefined } }> | null | undefined } } | null | undefined };

export type ViewerDraftsQueryVariables = Exact<{
  after?: InputMaybe<Scalars['String']['input']>;
}>;


export type ViewerDraftsQuery = { viewer?: { id: string, drafts: { pageInfo: { endCursor?: string | null | undefined, hasNextPage: boolean }, edges?: Array<{ node: { id: string, title?: string | null | undefined, content?: string | null | undefined, summary?: string | null | undefined, createdAt: any, updatedAt: any, tags?: Array<string> | null | undefined, cover?: string | null | undefined } }> | null | undefined } } | null | undefined };

export type ViewerCollectionsQueryVariables = Exact<{
  after?: InputMaybe<Scalars['String']['input']>;
}>;


export type ViewerCollectionsQuery = { viewer?: { id: string, collections: { totalCount: number, pageInfo: { endCursor?: string | null | undefined, hasNextPage: boolean }, edges?: Array<{ node: { id: string, title: string, description?: string | null | undefined, cover?: string | null | undefined, articles: { edges?: Array<{ node: { id: string, shortHash: string, title: string, slug: string } }> | null | undefined } } }> | null | undefined } } | null | undefined };

export type ViewerProfileQueryVariables = Exact<{ [key: string]: never; }>;


export type ViewerProfileQuery = { viewer?: { id: string, userName?: string | null | undefined, displayName?: string | null | undefined, avatar?: string | null | undefined, info: { description?: string | null | undefined, profileCover?: string | null | undefined }, settings: { language: UserLanguage } } | null | undefined };
